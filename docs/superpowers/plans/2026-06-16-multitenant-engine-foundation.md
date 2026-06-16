# Multi-tenant Engine Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Commons storage tenant-aware — each tenant gets an isolated git-backed subtree — by adding a per-tenant engine factory and tenant-scoped lock keys, reusing 100% of the existing engine logic.

**Architecture:** This is **Step 1** of [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md) (see ADR-2). Tenant = a top-level directory: `<COMMONS_ROOT>/tenants/<tenantId>/{repos,worktrees,meta}`. A new `EngineRegistry` returns a cached `Engine` per tenant by calling the existing `createEngine(join(root, 'tenants', tenantId))` — the engine itself is unchanged. The `WorkspaceSerializer` stays a single shared instance, but mutating ops are keyed by `tenant:workspace` so one tenant's locks never block another's.

**Scope guard:** This step is **purely additive** — it creates two new units (`scopeKey`, `createEngineRegistry`) and does NOT modify the engine, MCP, or API wiring. Rewiring the API/MCP to resolve a tenant from the session belongs to Step 3 (auth), when `tenantId` actually exists. Therefore all 103 existing tests must remain green; this step only adds tests.

**Tech Stack:** TypeScript (ESM, executed via tsx), Vitest, simple-git, Node `node:fs`/`node:path`. Tests use a real `mkdtemp` dir + `afterEach` cleanup (no git mocking), matching `test/engine.test.ts`.

**Why no data migration:** the beta starts fresh; the dev `./data` dir is gitignored demo data. No existing-tenant migration is needed.

---

### Task 1: Tenant-scoped serializer key (`scopeKey`)

The serializer (`src/util/serializer.ts`) is generic and keys lock chains by any string. To isolate tenants at the lock layer, all mutating ops will eventually be keyed by `tenant:workspace` instead of bare `workspace`. This task adds the single-source-of-truth helper and proves the isolation guarantee.

**Files:**
- Modify: `src/util/serializer.ts` (append a `scopeKey` export)
- Test: `test/serializer.test.ts` (append a `scopeKey` describe block)

- [ ] **Step 1: Write the failing tests**

Append to `test/serializer.test.ts`. Also update the import on line 2 to pull in `scopeKey`:

Change line 2 from:
```ts
import { WorkspaceSerializer } from '../src/util/serializer.js';
```
to:
```ts
import { WorkspaceSerializer, scopeKey } from '../src/util/serializer.js';
```

Then append this block at the end of the file (after the existing `describe('WorkspaceSerializer', ...)` block):
```ts
describe('scopeKey', () => {
  const op = (order: string[], id: string, ms: number) => async () => {
    order.push(`${id}-start`);
    await new Promise((r) => setTimeout(r, ms));
    order.push(`${id}-end`);
  };

  it('namespaces a workspace under a tenant', () => {
    expect(scopeKey('acme', 'ws1')).toBe('acme:ws1');
  });

  it('lets the same workspace id in different tenants run concurrently', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    await Promise.all([
      s.run(scopeKey('acme', 'ws1'), op(order, 'a', 30)),
      s.run(scopeKey('globex', 'ws1'), op(order, 'b', 1)),
    ]);
    // b (tenant globex) finishes before a (tenant acme) despite the same ws id
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });

  it('serializes the same workspace within one tenant', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    await Promise.all([
      s.run(scopeKey('acme', 'ws1'), op(order, 'a', 30)),
      s.run(scopeKey('acme', 'ws1'), op(order, 'b', 1)),
    ]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/serializer.test.ts`
Expected: FAIL — `scopeKey` is not exported (import error / `scopeKey is not a function`).

- [ ] **Step 3: Add the minimal implementation**

Append to `src/util/serializer.ts` (after the closing `}` of the `WorkspaceSerializer` class):
```ts
/** Build a serializer key scoped to a tenant so locks never collide across
 *  tenants: tenant A's workspace "ws1" must not block tenant B's "ws1".
 *  Tenant ids are validated to [A-Za-z0-9_-]+, so ':' is an unambiguous separator. */
export function scopeKey(tenantId: string, workspace: string): string {
  return `${tenantId}:${workspace}`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/serializer.test.ts`
Expected: PASS — all `WorkspaceSerializer` and `scopeKey` tests green.

- [ ] **Step 5: Commit**

```bash
git add src/util/serializer.ts test/serializer.test.ts
git commit -m "feat(serializer): add tenant-scoped scopeKey for lock isolation"
```
(Append the required `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer to the commit message.)

---

### Task 2: Per-tenant engine factory (`EngineRegistry`)

A factory that returns an `Engine` whose storage root is `<root>/tenants/<tenantId>`, caching one instance per tenant and validating the tenant id with the same `[A-Za-z0-9_-]+` rule the engine uses for workspace/proposal ids.

**Files:**
- Create: `src/engine/registry.ts`
- Test: `test/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/registry.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineRegistry } from '../src/engine/registry.js';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'commons-reg-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('EngineRegistry', () => {
  it('rejects an invalid tenant id', () => {
    const reg = createEngineRegistry(root);
    expect(() => reg.forTenant('bad id!')).toThrow(/invalid tenant id/);
    expect(() => reg.rootFor('../escape')).toThrow(/invalid tenant id/);
  });

  it('isolates workspaces with the same id across tenants', async () => {
    const reg = createEngineRegistry(root);
    await reg.forTenant('acme').createWorkspace({ id: 'ws1', seed: { 'a.md': 'ACME' } });
    await reg.forTenant('globex').createWorkspace({ id: 'ws1', seed: { 'a.md': 'GLOBEX' } });

    expect(await reg.forTenant('acme').readFile('ws1', 'a.md')).toBe('ACME');
    expect(await reg.forTenant('globex').readFile('ws1', 'a.md')).toBe('GLOBEX');
  });

  it('stores each tenant under <root>/tenants/<id>', async () => {
    const reg = createEngineRegistry(root);
    await reg.forTenant('acme').createWorkspace({ id: 'ws1', seed: { 'a.md': 'x' } });
    expect(existsSync(join(root, 'tenants', 'acme', 'repos', 'ws1', '.git'))).toBe(true);
  });

  it('does not leak one tenant\'s workspaces into another', async () => {
    const reg = createEngineRegistry(root);
    await reg.forTenant('acme').createWorkspace({ id: 'ws1', seed: { 'a.md': 'x' } });
    expect(await reg.forTenant('acme').listWorkspaces()).toEqual(['ws1']);
    expect(await reg.forTenant('globex').listWorkspaces()).toEqual([]);
  });

  it('returns a cached engine instance per tenant', () => {
    const reg = createEngineRegistry(root);
    expect(reg.forTenant('acme')).toBe(reg.forTenant('acme'));
    expect(reg.forTenant('acme')).not.toBe(reg.forTenant('globex'));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/registry.test.ts`
Expected: FAIL — cannot find module `../src/engine/registry.js` (file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `src/engine/registry.ts`:
```ts
import { join } from 'node:path';
import { createEngine } from './index.js';
import type { Engine } from './types.js';

const TENANT_ID = /^[A-Za-z0-9_-]+$/;

export interface EngineRegistry {
  /** Engine scoped to one tenant's isolated storage subtree. Cached per tenant. */
  forTenant(tenantId: string): Engine;
  /** Absolute-ish storage root for a tenant (for backup / repair tooling). Validates id. */
  rootFor(tenantId: string): string;
}

/** Per-tenant engine factory. Each tenant gets an isolated subtree at
 *  <rootDir>/tenants/<tenantId>; the underlying engine is reused unchanged. */
export function createEngineRegistry(rootDir: string): EngineRegistry {
  const cache = new Map<string, Engine>();
  const rootFor = (tenantId: string): string => {
    if (!TENANT_ID.test(tenantId)) throw new Error(`invalid tenant id: ${tenantId}`);
    return join(rootDir, 'tenants', tenantId);
  };
  return {
    rootFor,
    forTenant(tenantId: string): Engine {
      const path = rootFor(tenantId); // throws on invalid id
      let engine = cache.get(tenantId);
      if (!engine) {
        engine = createEngine(path);
        cache.set(tenantId, engine);
      }
      return engine;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/registry.test.ts`
Expected: PASS — all 5 EngineRegistry tests green.

- [ ] **Step 5: Commit**

```bash
git add src/engine/registry.ts test/registry.test.ts
git commit -m "feat(engine): add per-tenant EngineRegistry for storage isolation"
```
(Append the required `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.)

---

### Task 3: Full-suite regression check

Confirm the additive change broke nothing in the existing 103 tests.

**Files:** none (verification only).

- [ ] **Step 1: Run the entire suite**

Run: `npm test`
Expected: PASS — previous 103 tests **plus** the new `scopeKey` (3) and `EngineRegistry` (5) tests = **111 tests passing**, 16 test files. If any previously-green test now fails, the change was not purely additive — investigate before proceeding (do NOT paper over with a snapshot update).

- [ ] **Step 2: Update the architecture doc's build-order checkbox**

In [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md), under "Thứ tự xây", mark step 1 done by changing the line:
```
1. **Nền multi-tenant trong engine** (ADR-2): root theo tenant + serializer key `${tenant}:${ws}`.
```
to:
```
1. ✅ **Nền multi-tenant trong engine** (ADR-2): root theo tenant + serializer key `${tenant}:${ws}`.
```

- [ ] **Step 3: Commit**

```bash
git add SAAS_BETA_ARCHITECTURE.md
git commit -m "docs(saas): mark multi-tenant engine foundation (step 1) complete"
```
(Append the required `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.)

---

## Self-Review

**Spec coverage (vs ADR-2 + build-order step 1):**
- "root theo tenant" → Task 2 (`createEngineRegistry`, `<root>/tenants/<id>`). ✓
- "serializer key `${tenant}:${ws}`" → Task 1 (`scopeKey`). ✓
- "Tái dùng 100% logic engine" → Task 2 reuses `createEngine` unchanged; no engine edits. ✓
- "Cô lập filesystem mạnh" → Task 2 isolation + leak tests. ✓
- "Serializer phải key theo tenant + workspace … vẫn một WorkspaceSerializer dùng chung" → Task 1 keeps one serializer, only changes the key. ✓

**Out of scope (deferred to later steps, intentionally):** API/MCP rewiring to resolve tenant from session (Step 3, auth); passing per-tenant root to the agent's MCP child (Step 4/5); SQLite tenant registry mapping user→tenant (Step 2 of build order / ADR-7). Noted in the plan header.

**Placeholder scan:** none — every code/test step contains complete content and exact run commands.

**Type consistency:** `EngineRegistry` exposes `forTenant(tenantId): Engine` and `rootFor(tenantId): string`; both names are used identically in `test/registry.test.ts` and `src/engine/registry.ts`. `scopeKey(tenantId, workspace): string` matches between `src/util/serializer.ts` and `test/serializer.test.ts`. `forTenant` returns the existing `Engine` type from `src/engine/types.ts`, whose `createWorkspace`/`readFile`/`listWorkspaces` signatures are exercised exactly as defined in `src/engine/index.ts`.
