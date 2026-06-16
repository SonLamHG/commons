# SaaS Metadata Store (SQLite) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the SaaS metadata layer — a typed SQLite store for tenants, users, invites (allowlist), agent runs + usage, feedback, and analytics events — that later steps (auth, cost-cap/metering, analytics) build on.

**Architecture:** This is **Step 2** of [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md) (see ADR-7). A new `src/db/` module exposes `createDb(location)` returning a typed `Db` store. Storage uses Node's **built-in `node:sqlite` (`DatabaseSync`)** — dependency-free, matching the project's philosophy (cf. `loadEnv` via `process.loadEnvFile`). Verified working on the installed Node v22.14.0 with no flag (an `ExperimentalWarning` is printed to stderr, which is harmless — and stderr-only is safe even for the MCP stdio server).

**Scope guard:** This step is **purely additive** — it creates `src/db/{schema,types,index}.ts` + tests and does NOT wire the DB into `main.ts`/API/MCP. Wiring happens when consumers exist: auth (Step 3) reads invites/users, metering (Step 5) writes runs/usage, analytics/feedback (Step 6) write events/feedback. All 111 existing tests must stay green; this step only adds tests. The production DB will live at `<COMMONS_ROOT>/commons.db` (on the persistent volume, gitignored) — that path is wired in a later step, not here.

**Tech Stack:** TypeScript (ESM, tsx), Vitest, `node:sqlite` `DatabaseSync`. Reuses `generateId` from `src/util/id.ts`. Tests open an in-memory DB (`:memory:`), no temp files needed.

**Conventions locked in here (used by later tasks — keep consistent):**
- Timestamps are ISO strings (`new Date().toISOString()`), matching the engine.
- Emails are normalised (`trim().toLowerCase()`) on every write and lookup.
- Row column names are `snake_case` (SQL); returned object fields mirror them (`user_id`, `cost_usd`, …). The one computed shape is `UsageSummary` (`{ runs, costUsd }`).
- `get()`/`all()` from `node:sqlite` are typed `unknown`; cast results to an inline row shape.

---

### Task 1: Schema + `createDb` + tenants & users

Create the module foundation: the full DDL, the type definitions, and `createDb` with tenant/user accessors.

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/types.ts`
- Create: `src/db/index.ts`
- Test: `test/db.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/db.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDb } from '../src/db/index.js';

let db: ReturnType<typeof createDb>;
beforeEach(() => { db = createDb(':memory:'); });
afterEach(() => { db.close(); });

describe('db: tenants & users', () => {
  it('creates and reads a tenant', () => {
    const t = db.createTenant('acme');
    expect(t.id).toBe('acme');
    expect(db.getTenant('acme')?.id).toBe('acme');
    expect(db.getTenant('nope')).toBeUndefined();
  });

  it('rejects an invalid tenant id', () => {
    expect(() => db.createTenant('bad id!')).toThrow(/invalid tenant id/);
  });

  it('creates a user and looks it up by email (case-insensitive)', () => {
    db.createTenant('acme');
    const u = db.createUser('Alice@Example.com', 'acme');
    expect(u.email).toBe('alice@example.com');
    expect(u.tenant_id).toBe('acme');
    expect(db.getUserByEmail('ALICE@example.com')?.id).toBe(u.id);
    expect(db.getUserById(u.id)?.email).toBe('alice@example.com');
  });

  it('enforces unique email', () => {
    db.createTenant('acme');
    db.createUser('a@x.com', 'acme');
    expect(() => db.createUser('a@x.com', 'acme')).toThrow();
  });

  it('rejects a user for a non-existent tenant (FK)', () => {
    expect(() => db.createUser('a@x.com', 'ghost')).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL — cannot find module `../src/db/index.js`.

- [ ] **Step 3: Write the implementation**

Create `src/db/schema.ts`:
```ts
/** DDL for the SaaS metadata DB. Idempotent (IF NOT EXISTS), applied on open.
 *  Kept separate from git state — see SAAS_BETA_ARCHITECTURE.md ADR-7. */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  email TEXT PRIMARY KEY,
  invited_at TEXT NOT NULL,
  accepted_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  workspace TEXT NOT NULL,
  status TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  num_turns INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_runs_user_created ON runs(user_id, created_at);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  tenant_id TEXT,
  message TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  tenant_id TEXT,
  name TEXT NOT NULL,
  props TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
`;
```

Create `src/db/types.ts`:
```ts
export interface Tenant { id: string; created_at: string; }
export interface User { id: string; email: string; tenant_id: string; created_at: string; }

export interface Db {
  createTenant(id: string): Tenant;
  getTenant(id: string): Tenant | undefined;

  createUser(email: string, tenantId: string): User;
  getUserByEmail(email: string): User | undefined;
  getUserById(id: string): User | undefined;

  close(): void;
}
```

Create `src/db/index.ts`:
```ts
import { DatabaseSync } from 'node:sqlite';
import { generateId } from '../util/id.js';
import { SCHEMA_SQL } from './schema.js';
import type { Db } from './types.js';

const TENANT_ID = /^[A-Za-z0-9_-]+$/; // must match EngineRegistry: a tenant id is also a safe dir name
const normEmail = (email: string): string => email.trim().toLowerCase();

/** Open (or create) the SaaS metadata SQLite DB at `location` (':memory:' in tests).
 *  Applies pragmas + schema idempotently. Dependency-free via node:sqlite. */
export function createDb(location: string): Db {
  const db = new DatabaseSync(location);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);

  return {
    createTenant(id) {
      if (!TENANT_ID.test(id)) throw new Error(`invalid tenant id: ${id}`);
      const created_at = new Date().toISOString();
      db.prepare('INSERT INTO tenants (id, created_at) VALUES (?, ?)').run(id, created_at);
      return { id, created_at };
    },
    getTenant(id) {
      return db.prepare('SELECT id, created_at FROM tenants WHERE id = ?').get(id) as
        | { id: string; created_at: string } | undefined;
    },

    createUser(email, tenantId) {
      const id = generateId('usr');
      const e = normEmail(email);
      const created_at = new Date().toISOString();
      db.prepare('INSERT INTO users (id, email, tenant_id, created_at) VALUES (?, ?, ?, ?)')
        .run(id, e, tenantId, created_at);
      return { id, email: e, tenant_id: tenantId, created_at };
    },
    getUserByEmail(email) {
      return db.prepare('SELECT id, email, tenant_id, created_at FROM users WHERE email = ?')
        .get(normEmail(email)) as
        | { id: string; email: string; tenant_id: string; created_at: string } | undefined;
    },
    getUserById(id) {
      return db.prepare('SELECT id, email, tenant_id, created_at FROM users WHERE id = ?').get(id) as
        | { id: string; email: string; tenant_id: string; created_at: string } | undefined;
    },

    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/db.test.ts`
Expected: PASS — 5 tenant/user tests green. (An `ExperimentalWarning: SQLite ...` line on stderr is expected and harmless.)

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/types.ts src/db/index.ts test/db.test.ts
git commit -m "feat(db): add SQLite metadata store with tenants and users"
```
(Append the required `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.)

---

### Task 2: Invites (allowlist)

Add the invite allowlist that Step 3's invite-only auth will gate on.

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/index.ts`
- Test: `test/db.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `test/db.test.ts`:
```ts
describe('db: invites (allowlist)', () => {
  it('adds an invite and checks membership case-insensitively', () => {
    db.addInvite('Bob@Example.com');
    expect(db.isInvited('bob@example.com')).toBe(true);
    expect(db.isInvited('nobody@example.com')).toBe(false);
  });

  it('is idempotent on re-invite and tracks acceptance', () => {
    const first = db.addInvite('c@x.com');
    expect(first.accepted_at).toBeNull();
    db.addInvite('c@x.com'); // no throw, idempotent
    db.markInviteAccepted('C@X.com');
    const again = db.addInvite('c@x.com');
    expect(again.accepted_at).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL — `db.addInvite is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/db/types.ts`, add the `Invite` type after the `User` interface:
```ts
export interface Invite { email: string; invited_at: string; accepted_at: string | null; }
```

In `src/db/types.ts`, add these signatures to the `Db` interface immediately before the `close(): void;` line:
```ts
  addInvite(email: string): Invite;
  isInvited(email: string): boolean;
  markInviteAccepted(email: string): void;

```

In `src/db/index.ts`, add these methods to the returned object immediately before the `close() {` method:
```ts
    addInvite(email) {
      const e = normEmail(email);
      db.prepare('INSERT OR IGNORE INTO invites (email, invited_at) VALUES (?, ?)')
        .run(e, new Date().toISOString());
      return db.prepare('SELECT email, invited_at, accepted_at FROM invites WHERE email = ?')
        .get(e) as { email: string; invited_at: string; accepted_at: string | null };
    },
    isInvited(email) {
      return db.prepare('SELECT 1 FROM invites WHERE email = ?').get(normEmail(email)) !== undefined;
    },
    markInviteAccepted(email) {
      db.prepare('UPDATE invites SET accepted_at = ? WHERE email = ?')
        .run(new Date().toISOString(), normEmail(email));
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/db.test.ts`
Expected: PASS — tenant/user + invite tests green.

- [ ] **Step 5: Commit**

```bash
git add src/db/types.ts src/db/index.ts test/db.test.ts
git commit -m "feat(db): add invite allowlist accessors"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 3: Runs & usage (metering foundation)

Add agent-run records and a per-user usage summary that Step 5's cost-cap will read.

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/index.ts`
- Test: `test/db.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `test/db.test.ts`:
```ts
describe('db: runs & usage', () => {
  const seedUser = () => { db.createTenant('acme'); return db.createUser('a@x.com', 'acme').id; };

  it('creates a running run and finishes it', () => {
    const userId = seedUser();
    const run = db.createRun({ userId, tenantId: 'acme', workspace: 'ws1', model: 'claude-haiku-4-5' });
    expect(run.status).toBe('running');
    expect(run.cost_usd).toBe(0);
    db.finishRun(run.id, { status: 'success', costUsd: 0.012, numTurns: 5 });
    const got = db.getRun(run.id);
    expect(got?.status).toBe('success');
    expect(got?.cost_usd).toBeCloseTo(0.012);
    expect(got?.num_turns).toBe(5);
    expect(got?.finished_at).not.toBeNull();
  });

  it('summarises usage for a user since a timestamp', () => {
    const userId = seedUser();
    const r1 = db.createRun({ userId, tenantId: 'acme', workspace: 'ws1' });
    const r2 = db.createRun({ userId, tenantId: 'acme', workspace: 'ws1' });
    db.finishRun(r1.id, { status: 'success', costUsd: 0.01, numTurns: 2 });
    db.finishRun(r2.id, { status: 'success', costUsd: 0.02, numTurns: 3 });

    const all = db.usageSince(userId, '1970-01-01T00:00:00.000Z');
    expect(all.runs).toBe(2);
    expect(all.costUsd).toBeCloseTo(0.03);

    const future = db.usageSince(userId, '2999-01-01T00:00:00.000Z');
    expect(future).toEqual({ runs: 0, costUsd: 0 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL — `db.createRun is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/db/types.ts`, add these types after the `Invite` interface:
```ts
export interface Run {
  id: string; user_id: string; tenant_id: string; workspace: string;
  status: string; cost_usd: number; num_turns: number; model: string | null;
  created_at: string; finished_at: string | null;
}
export interface UsageSummary { runs: number; costUsd: number; }
```

In `src/db/types.ts`, add these signatures to the `Db` interface immediately before the `close(): void;` line:
```ts
  createRun(input: { userId: string; tenantId: string; workspace: string; model?: string | null }): Run;
  finishRun(id: string, result: { status: string; costUsd: number; numTurns: number }): void;
  getRun(id: string): Run | undefined;
  usageSince(userId: string, sinceIso: string): UsageSummary;

```

In `src/db/index.ts`, add these methods immediately before the `close() {` method:
```ts
    createRun({ userId, tenantId, workspace, model }) {
      const id = generateId('run');
      const created_at = new Date().toISOString();
      db.prepare(
        'INSERT INTO runs (id, user_id, tenant_id, workspace, status, cost_usd, num_turns, model, created_at) ' +
        "VALUES (?, ?, ?, ?, 'running', 0, 0, ?, ?)",
      ).run(id, userId, tenantId, workspace, model ?? null, created_at);
      return {
        id, user_id: userId, tenant_id: tenantId, workspace,
        status: 'running', cost_usd: 0, num_turns: 0, model: model ?? null,
        created_at, finished_at: null,
      };
    },
    finishRun(id, { status, costUsd, numTurns }) {
      db.prepare('UPDATE runs SET status = ?, cost_usd = ?, num_turns = ?, finished_at = ? WHERE id = ?')
        .run(status, costUsd, numTurns, new Date().toISOString(), id);
    },
    getRun(id) {
      return db.prepare(
        'SELECT id, user_id, tenant_id, workspace, status, cost_usd, num_turns, model, created_at, finished_at ' +
        'FROM runs WHERE id = ?',
      ).get(id) as {
        id: string; user_id: string; tenant_id: string; workspace: string;
        status: string; cost_usd: number; num_turns: number; model: string | null;
        created_at: string; finished_at: string | null;
      } | undefined;
    },
    usageSince(userId, sinceIso) {
      const row = db.prepare(
        'SELECT COUNT(*) AS runs, COALESCE(SUM(cost_usd), 0) AS costUsd FROM runs WHERE user_id = ? AND created_at >= ?',
      ).get(userId, sinceIso) as { runs: number; costUsd: number };
      return { runs: row.runs, costUsd: row.costUsd };
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/db.test.ts`
Expected: PASS — tenant/user + invite + run/usage tests green.

- [ ] **Step 5: Commit**

```bash
git add src/db/types.ts src/db/index.ts test/db.test.ts
git commit -m "feat(db): add agent run records and per-user usage summary"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 4: Feedback & analytics events

Add the feedback channel and analytics-event recorder that Step 6 (satisfaction measurement) writes to.

**Files:**
- Modify: `src/db/types.ts`
- Modify: `src/db/index.ts`
- Test: `test/db.test.ts` (append a describe block)

- [ ] **Step 1: Write the failing tests**

Append to `test/db.test.ts`:
```ts
describe('db: feedback & events', () => {
  it('stores and lists feedback', () => {
    const f1 = db.addFeedback({ message: 'first', userId: null, tenantId: null });
    const f2 = db.addFeedback({ message: 'second', context: 'proposals tab' });
    const list = db.listFeedback();
    expect(list.length).toBe(2);
    expect(list.map((f) => f.message)).toContain('first');
    expect(list.find((f) => f.id === f2.id)?.context).toBe('proposals tab');
    expect(list.find((f) => f.id === f1.id)?.context).toBeNull();
  });

  it('records events and counts by name', () => {
    db.recordEvent({ name: 'workspace_created', tenantId: 'acme' });
    db.recordEvent({ name: 'proposal_merged', userId: 'u1', props: { ws: 'ws1' } });
    db.recordEvent({ name: 'proposal_merged' });
    expect(db.countEvents('proposal_merged')).toBe(2);
    expect(db.countEvents('workspace_created')).toBe(1);
    expect(db.countEvents('never')).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL — `db.addFeedback is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/db/types.ts`, add this type after the `UsageSummary` interface:
```ts
export interface Feedback {
  id: string; user_id: string | null; tenant_id: string | null;
  message: string; context: string | null; created_at: string;
}
```

In `src/db/types.ts`, add these signatures to the `Db` interface immediately before the `close(): void;` line:
```ts
  addFeedback(input: { userId?: string | null; tenantId?: string | null; message: string; context?: string | null }): Feedback;
  listFeedback(): Feedback[];
  recordEvent(input: { name: string; userId?: string | null; tenantId?: string | null; props?: unknown }): void;
  countEvents(name: string): number;

```

In `src/db/index.ts`, add these methods immediately before the `close() {` method:
```ts
    addFeedback({ userId, tenantId, message, context }) {
      const id = generateId('fb');
      const created_at = new Date().toISOString();
      db.prepare('INSERT INTO feedback (id, user_id, tenant_id, message, context, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, userId ?? null, tenantId ?? null, message, context ?? null, created_at);
      return { id, user_id: userId ?? null, tenant_id: tenantId ?? null, message, context: context ?? null, created_at };
    },
    listFeedback() {
      return db.prepare(
        'SELECT id, user_id, tenant_id, message, context, created_at FROM feedback ORDER BY created_at DESC',
      ).all() as {
        id: string; user_id: string | null; tenant_id: string | null;
        message: string; context: string | null; created_at: string;
      }[];
    },
    recordEvent({ name, userId, tenantId, props }) {
      const id = generateId('evt');
      db.prepare('INSERT INTO events (id, user_id, tenant_id, name, props, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, userId ?? null, tenantId ?? null, name, props === undefined ? null : JSON.stringify(props), new Date().toISOString());
    },
    countEvents(name) {
      const row = db.prepare('SELECT COUNT(*) AS c FROM events WHERE name = ?').get(name) as { c: number };
      return row.c;
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/db.test.ts`
Expected: PASS — all `db:` describe blocks green (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/db/types.ts src/db/index.ts test/db.test.ts
git commit -m "feat(db): add feedback and analytics event accessors"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 5: Full-suite regression check + mark step 2 done

**Files:** Modify `SAAS_BETA_ARCHITECTURE.md` (build-order checkbox).

- [ ] **Step 1: Run the entire suite**

Run: `npm test`
Expected: PASS — previous 111 tests **plus** 11 new `db:` tests = **122 tests**, 16 test files. (Expect `ExperimentalWarning: SQLite` lines on stderr — harmless.) If any previously-green test now fails, investigate before proceeding — do not paper over it.

- [ ] **Step 2: Mark step 2 done in the architecture doc**

In [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md), under "Thứ tự xây", change:
```
2. **SQLite + schema** (ADR-7): invites, users, tenants, runs, usage, feedback, events.
```
to:
```
2. ✅ **SQLite + schema** (ADR-7): invites, users, tenants, runs, usage, feedback, events.
```

- [ ] **Step 3: Commit**

```bash
git add SAAS_BETA_ARCHITECTURE.md docs/superpowers/plans/2026-06-16-saas-sqlite-store.md
git commit -m "docs(saas): mark SQLite metadata store (step 2) complete"
```
(Append the `Co-Authored-By` trailer.)

---

## Self-Review

**Spec coverage (vs ADR-7 + build-order step 2 "invites, users, tenants, runs, usage, feedback, events"):**
- tenants → Task 1 ✓ · users → Task 1 ✓ · invites → Task 2 ✓ · runs + usage → Task 3 ✓ · feedback → Task 4 ✓ · events → Task 4 ✓
- "tách khỏi git" → separate `src/db/` module + SQLite file under COMMONS_ROOT, never committed (data/ gitignored). ✓
- "SQLite (better-sqlite3)" in ADR-7 → **deviation:** uses built-in `node:sqlite` instead, for dependency-free parity with the project. Documented in the plan header; functionally equivalent for single-node. ✓

**Out of scope (deferred, intentional):** wiring `createDb` into `main.ts`; auth consuming invites/users (Step 3); metering writing runs from the agent runner (Step 5); analytics/feedback endpoints + UI (Step 6). Stated in the scope guard.

**Placeholder scan:** none — every code/test step has complete content and exact commands.

**Type consistency:** `Db` method names are identical between `src/db/types.ts` (declarations), `src/db/index.ts` (implementations), and `test/db.test.ts` (call sites): `createTenant`, `getTenant`, `createUser`, `getUserByEmail`, `getUserById`, `addInvite`, `isInvited`, `markInviteAccepted`, `createRun`, `finishRun`, `getRun`, `usageSince`, `addFeedback`, `listFeedback`, `recordEvent`, `countEvents`, `close`. `createRun` takes `{ userId, tenantId, workspace, model? }` and returns `Run` (snake_case fields) — matched in test (`run.cost_usd`, `run.status`). `usageSince` returns `{ runs, costUsd }` (`UsageSummary`) — matched in test. Every later task inserts its `Db` signatures before `close(): void;` and its impl before `close() {`, so the object literal always satisfies the interface at each commit.
