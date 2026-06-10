# Commons Review UI — Implementation Plan (Subsystem 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A web app where a human sees each proposal as a diff and clicks Approve (merge) / Reject (discard) — the human gate that agents (via MCP) cannot perform.

**Architecture:** A Fastify REST API (own Node process) imports `createEngine` directly and owns its own `WorkspaceSerializer` for merge/discard (separate process from the MCP stdio child → git file-locking covers cross-process safety, per KNOWN_LIMITATIONS #1b). A Vite + React + TS SPA calls the API. Diffs rendered with a lightweight line-coloring component (no diff lib). Plain CSS, no Tailwind. MVP scope: list workspaces → list proposals → view diffs → approve/reject. NOT in scope: auth, inline-edit, realtime, create-workspace-in-UI.

**Tech Stack:** Fastify 5, @fastify/static, Vite 6, React 18, TypeScript, vitest (API tests via `fastify.inject()`; frontend manually verified by clicking — the user testing it IS the test, per mindset doc).

---

## File Structure

```
commons/
  src/
    util/serializer.ts      # MOVED from src/mcp/serializer.ts (shared by mcp + api)
    engine/index.ts         # + listWorkspaces()
    engine/types.ts         # + listWorkspaces in Engine
    api/server.ts           # buildApi(engine, serializer): Fastify — routes only, testable
    api/main.ts             # entry: createEngine(COMMONS_ROOT) + serve + static
  web/
    index.html
    vite.config.ts
    src/main.tsx
    src/App.tsx
    src/api.ts              # typed fetch client
    src/components/ProposalList.tsx
    src/components/DiffView.tsx
    src/styles.css
  test/api.test.ts
```

---

## Task 1: Move serializer + add engine.listWorkspaces()

**Files:**
- Create: `src/util/serializer.ts` (move) ; Delete: `src/mcp/serializer.ts`
- Modify: `src/mcp/server.ts` (import path)
- Modify: `src/engine/types.ts`, `src/engine/index.ts`
- Test: `test/engine.test.ts`, `test/serializer.test.ts`

- [ ] **Step 1: Move serializer.** Create `src/util/serializer.ts` with the exact current contents of `src/mcp/serializer.ts`, then delete `src/mcp/serializer.ts`. Update the import in `src/mcp/server.ts` from `'./serializer.js'` to `'../util/serializer.js'`.

- [ ] **Step 2: Serializer test (lock behavior).** Create `test/serializer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { WorkspaceSerializer } from '../src/util/serializer.js';

describe('WorkspaceSerializer', () => {
  it('serializes operations for the same key (no overlap)', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    const op = (id: string, ms: number) => async () => {
      order.push(`${id}-start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${id}-end`);
    };
    await Promise.all([s.run('ws', op('a', 30)), s.run('ws', op('b', 1))]);
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end']);
  });

  it('allows different keys to run concurrently', async () => {
    const s = new WorkspaceSerializer();
    const order: string[] = [];
    const op = (id: string, ms: number) => async () => {
      order.push(`${id}-start`);
      await new Promise((r) => setTimeout(r, ms));
      order.push(`${id}-end`);
    };
    await Promise.all([s.run('x', op('a', 30)), s.run('y', op('b', 1))]);
    expect(order[0]).toBe('a-start');
    expect(order).toContain('b-end');
    expect(order.indexOf('b-end')).toBeLessThan(order.indexOf('a-end'));
  });
});
```

- [ ] **Step 3: Run** `npm test` — serializer tests pass; existing tests still pass; mcp import resolves.

- [ ] **Step 4: Add listWorkspaces to the Engine interface.** In `src/engine/types.ts`, add to `interface Engine`:

```ts
  listWorkspaces(): Promise<string[]>;
```

- [ ] **Step 5: Failing test.** Append to `test/engine.test.ts`:

```ts
describe('listWorkspaces', () => {
  it('lists created workspaces and ignores non-workspace dirs', async () => {
    expect(await engine.listWorkspaces()).toEqual([]);
    await engine.createWorkspace({ id: 'alpha', seed: { 'a.md': '1' } });
    await engine.createWorkspace({ id: 'beta', seed: { 'b.md': '2' } });
    expect((await engine.listWorkspaces()).sort()).toEqual(['alpha', 'beta']);
  });
});
```

- [ ] **Step 6: Run** `npm test` — new test FAILS (listWorkspaces not a function).

- [ ] **Step 7: Implement.** In `src/engine/index.ts`, add to the returned object (and ensure `readdirSync`, `existsSync`, `join` are imported — they are):

```ts
    async listWorkspaces() {
      const reposDir = join(rootDir, 'repos');
      if (!existsSync(reposDir)) return [];
      return readdirSync(reposDir).filter((name) => existsSync(join(reposDir, name, '.git')));
    },
```

- [ ] **Step 8: Run** `npm test` — all pass. `npx tsc --noEmit` zero errors.

- [ ] **Step 9: Commit.**
```bash
git add -A && git commit -m "refactor(util): move serializer; feat(engine): listWorkspaces"
```

---

## Task 2: API routes (Fastify, testable)

**Files:**
- Create: `src/api/server.ts`
- Test: `test/api.test.ts`
- Install: `npm install fastify`

- [ ] **Step 1: Install Fastify.** `npm install fastify`

- [ ] **Step 2: Failing test.** Create `test/api.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/engine/index.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { buildApi } from '../src/api/server.js';

let root: string;
let app: ReturnType<typeof buildApi>;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'commons-api-'));
  const engine = createEngine(root);
  await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
  await engine.createProposal('ws1', { id: 'p1', title: 'Add b' });
  await engine.writeProposalFile('ws1', 'p1', 'b.md', 'bee');
  await engine.submitProposal('ws1', 'p1', 'add b');
  app = buildApi(engine, new WorkspaceSerializer());
});
afterEach(async () => {
  await app.close();
  rmSync(root, { recursive: true, force: true });
});

const json = (r: { payload: string }) => JSON.parse(r.payload);

describe('API', () => {
  it('GET /api/workspaces lists workspaces', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual(['ws1']);
  });

  it('GET /api/workspaces/:ws/proposals lists proposals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(res)[0]).toMatchObject({ id: 'p1', status: 'submitted', title: 'Add b' });
  });

  it('GET diff returns per-file diffs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals/p1/diff' });
    const diffs = json(res);
    expect(diffs.find((d: any) => d.path === 'b.md').status).toBe('added');
  });

  it('POST approve merges the proposal', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/proposals/p1/approve' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ merged: true });
    const proposals = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(proposals)[0].status).toBe('merged');
  });

  it('POST reject discards the proposal', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/proposals/p1/reject' });
    expect(res.statusCode).toBe(200);
    const proposals = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(proposals)[0].status).toBe('discarded');
  });
});
```

- [ ] **Step 3: Run** `npm test` — api tests FAIL (buildApi not found).

- [ ] **Step 4: Implement.** Create `src/api/server.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import type { Engine } from '../engine/types.js';
import type { WorkspaceSerializer } from '../util/serializer.js';

export function buildApi(engine: Engine, serializer: WorkspaceSerializer): FastifyInstance {
  const app = Fastify();

  app.get('/api/workspaces', async () => engine.listWorkspaces());

  app.get('/api/workspaces/:ws/proposals', async (req) => {
    const { ws } = req.params as { ws: string };
    return engine.listProposals(ws);
  });

  app.get('/api/workspaces/:ws/proposals/:id/diff', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return engine.diffProposal(ws, id);
  });

  app.post('/api/workspaces/:ws/proposals/:id/approve', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return serializer.run(ws, () => engine.mergeProposal(ws, id));
  });

  app.post('/api/workspaces/:ws/proposals/:id/reject', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    await serializer.run(ws, () => engine.discardProposal(ws, id));
    return reply.send({ discarded: true });
  });

  return app;
}
```

- [ ] **Step 5: Run** `npm test` — all pass. `npx tsc --noEmit` zero errors.

- [ ] **Step 6: Commit.**
```bash
git add -A && git commit -m "feat(api): review API (list/diff/approve/reject) over engine"
```

---

## Task 3: API entry + static serving

**Files:**
- Create: `src/api/main.ts`
- Modify: `package.json` (scripts), install `@fastify/static`

- [ ] **Step 1: Install** `npm install @fastify/static`

- [ ] **Step 2: Implement** `src/api/main.ts`:

```ts
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { createEngine } from '../engine/index.js';
import { WorkspaceSerializer } from '../util/serializer.js';
import { buildApi } from './server.js';

const root = process.env.COMMONS_ROOT ?? join(process.cwd(), 'data');
const port = Number(process.env.PORT ?? 8787);

const app = buildApi(createEngine(root), new WorkspaceSerializer());

const dist = join(process.cwd(), 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html')); // SPA fallback
}

app.listen({ port, host: '0.0.0.0' })
  .then(() => process.stdout.write(`commons review UI on http://localhost:${port}\n`))
  .catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1); });
```

- [ ] **Step 3: Add scripts.** `npm pkg set scripts.api="tsx src/api/main.ts"`

- [ ] **Step 4: Smoke test.** Run `npm run seed` (if it exists, to populate data) then `npm run api`; in another shell `curl http://localhost:8787/api/workspaces` returns a JSON array. Stop the server. (No commit-blocking automated test here — covered by Task 2.)

- [ ] **Step 5: Commit.**
```bash
git add -A && git commit -m "feat(api): server entry + SPA static serving"
```

---

## Task 4: Frontend scaffold + workspace/proposal lists

**Files:**
- Create: `web/index.html`, `web/vite.config.ts`, `web/src/main.tsx`, `web/src/api.ts`, `web/src/App.tsx`, `web/src/components/ProposalList.tsx`, `web/src/styles.css`
- Install: `npm install -D vite @vitejs/plugin-react` and `npm install react react-dom @types/react @types/react-dom`

- [ ] **Step 1: Install deps** (commands above).

- [ ] **Step 2:** `web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Commons — Review</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3:** `web/vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: 'dist' },
});
```

- [ ] **Step 4:** `web/src/api.ts`:
```ts
export interface Proposal { id: string; branch: string; title: string; status: string; createdAt: string; }
export interface FileDiff { path: string; status: 'added' | 'modified' | 'deleted'; diff: string; }
export type MergeResult = { merged: true } | { merged: false; conflicts: string[] };

const j = async (r: Response) => { if (!r.ok) throw new Error(await r.text()); return r.json(); };

export const api = {
  workspaces: (): Promise<string[]> => fetch('/api/workspaces').then(j),
  proposals: (ws: string): Promise<Proposal[]> => fetch(`/api/workspaces/${ws}/proposals`).then(j),
  diff: (ws: string, id: string): Promise<FileDiff[]> => fetch(`/api/workspaces/${ws}/proposals/${id}/diff`).then(j),
  approve: (ws: string, id: string): Promise<MergeResult> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/approve`, { method: 'POST' }).then(j),
  reject: (ws: string, id: string): Promise<{ discarded: boolean }> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/reject`, { method: 'POST' }).then(j),
};
```

- [ ] **Step 5:** `web/src/main.tsx`:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```
(Note: with Vite, `from './App.js'` resolves to App.tsx; if the implementer prefers, `'./App'` also works. Keep consistent across files.)

- [ ] **Step 6:** `web/src/App.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { api, type Proposal } from './api.js';
import { ProposalList } from './components/ProposalList.js';

export function App() {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [ws, setWs] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);

  useEffect(() => { api.workspaces().then(setWorkspaces); }, []);
  const loadProposals = (w: string) => api.proposals(w).then(setProposals);
  useEffect(() => { if (ws) loadProposals(ws); }, [ws]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Commons</h1>
        <h2>Workspaces</h2>
        {workspaces.map((w) => (
          <button key={w} className={w === ws ? 'ws active' : 'ws'} onClick={() => setWs(w)}>{w}</button>
        ))}
      </aside>
      <main className="main">
        {ws
          ? <ProposalList ws={ws} proposals={proposals} onChanged={() => loadProposals(ws)} />
          : <p className="empty">Select a workspace.</p>}
      </main>
    </div>
  );
}
```

- [ ] **Step 7:** `web/src/components/ProposalList.tsx` (detail + diff wired in Task 5; for now list + select):
```tsx
import React, { useState } from 'react';
import { type Proposal } from '../api.js';
import { DiffView } from './DiffView.js';

export function ProposalList({ ws, proposals, onChanged }: {
  ws: string; proposals: Proposal[]; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div className="proposals">
      <div className="list">
        <h2>Proposals</h2>
        {proposals.length === 0 && <p className="empty">No proposals.</p>}
        {proposals.map((p) => (
          <button key={p.id} className={p.id === selected ? 'prop active' : 'prop'} onClick={() => setSelected(p.id)}>
            <span className={`badge ${p.status}`}>{p.status}</span>
            <span className="title">{p.title}</span>
          </button>
        ))}
      </div>
      <div className="detail">
        {selected
          ? <DiffView ws={ws} proposal={proposals.find((p) => p.id === selected)!} onChanged={() => { setSelected(null); onChanged(); }} />
          : <p className="empty">Select a proposal to review.</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 8:** `web/src/components/DiffView.tsx` — minimal placeholder (full impl in Task 5):
```tsx
import React from 'react';
import { type Proposal } from '../api.js';
export function DiffView({ ws, proposal, onChanged }: { ws: string; proposal: Proposal; onChanged: () => void; }) {
  return <div><h3>{proposal.title}</h3><p>diff coming in next task ({ws}/{proposal.id})</p><button onClick={onChanged}>back</button></div>;
}
```

- [ ] **Step 9:** `web/src/styles.css`:
```css
* { box-sizing: border-box; }
body { margin: 0; font-family: ui-sans-serif, system-ui, 'Segoe UI', sans-serif; color: #1a1a2e; background: #f7f7fb; }
.layout { display: flex; height: 100vh; }
.sidebar { width: 230px; background: #1a1a2e; color: #fff; padding: 16px; }
.sidebar h1 { font-size: 18px; margin: 0 0 16px; }
.sidebar h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #9a9ac0; }
.ws { display: block; width: 100%; text-align: left; background: none; border: none; color: #d8d8ee; padding: 8px; border-radius: 6px; cursor: pointer; }
.ws.active, .ws:hover { background: #2d2d52; color: #fff; }
.main { flex: 1; overflow: auto; }
.proposals { display: flex; height: 100%; }
.list { width: 320px; border-right: 1px solid #e4e4ee; padding: 16px; overflow: auto; }
.detail { flex: 1; padding: 24px; overflow: auto; }
.prop { display: flex; gap: 8px; align-items: center; width: 100%; text-align: left; background: #fff; border: 1px solid #e4e4ee; border-radius: 8px; padding: 10px; margin-bottom: 8px; cursor: pointer; }
.prop.active { border-color: #5b5bd6; box-shadow: 0 0 0 2px #5b5bd633; }
.title { font-weight: 600; }
.badge { font-size: 10px; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; color: #fff; }
.badge.submitted { background: #d97706; }
.badge.merged { background: #16a34a; }
.badge.discarded { background: #6b7280; }
.badge.open { background: #2563eb; }
.empty { color: #8a8aa0; }
.diff-file { border: 1px solid #e4e4ee; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }
.diff-file h4 { margin: 0; padding: 8px 12px; background: #f0f0f6; font-family: monospace; font-size: 13px; }
.diff-body { margin: 0; font-family: monospace; font-size: 12px; padding: 8px 0; overflow-x: auto; }
.diff-line { padding: 0 12px; white-space: pre; }
.diff-line.add { background: #e6ffed; color: #057a30; }
.diff-line.del { background: #ffeef0; color: #cb2431; }
.diff-line.meta { color: #8a8aa0; }
.actions { display: flex; gap: 12px; margin: 20px 0; }
.btn { padding: 10px 18px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; }
.btn.approve { background: #16a34a; color: #fff; }
.btn.reject { background: #ef4444; color: #fff; }
.conflict { background: #fff4e5; border: 1px solid #d97706; padding: 12px; border-radius: 8px; color: #92400e; }
```

- [ ] **Step 10: Verify scaffold builds.** Run `cd web && npx vite build` — completes with no errors (produces web/dist). Then `cd ..`.

- [ ] **Step 11: Commit.**
```bash
git add -A && git commit -m "feat(web): review UI scaffold + workspace/proposal lists"
```

---

## Task 5: Diff view + approve/reject actions

**Files:**
- Modify: `web/src/components/DiffView.tsx`

- [ ] **Step 1: Implement** `web/src/components/DiffView.tsx`:
```tsx
import React, { useEffect, useState } from 'react';
import { api, type Proposal, type FileDiff, type MergeResult } from '../api.js';

function DiffBody({ diff }: { diff: string }) {
  return (
    <pre className="diff-body">
      {diff.split('\n').map((line, i) => {
        const cls = line.startsWith('+') && !line.startsWith('+++') ? 'add'
          : line.startsWith('-') && !line.startsWith('---') ? 'del'
          : (line.startsWith('diff ') || line.startsWith('@@') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) ? 'meta'
          : '';
        return <div key={i} className={`diff-line ${cls}`}>{line || ' '}</div>;
      })}
    </pre>
  );
}

export function DiffView({ ws, proposal, onChanged }: { ws: string; proposal: Proposal; onChanged: () => void; }) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string[] | null>(null);

  useEffect(() => { setConflict(null); setDiffs(null); api.diff(ws, proposal.id).then(setDiffs); }, [ws, proposal.id]);

  const approve = async () => {
    setBusy(true);
    try {
      const res: MergeResult = await api.approve(ws, proposal.id);
      if (res.merged) onChanged();
      else setConflict(res.conflicts);
    } finally { setBusy(false); }
  };
  const reject = async () => { setBusy(true); try { await api.reject(ws, proposal.id); onChanged(); } finally { setBusy(false); } };

  const reviewable = proposal.status === 'submitted' || proposal.status === 'open';

  return (
    <div>
      <h3>{proposal.title} <span className={`badge ${proposal.status}`}>{proposal.status}</span></h3>
      {conflict && (
        <div className="conflict">
          Merge conflict on: {conflict.join(', ')}. Main was left untouched. Resolve and resubmit.
        </div>
      )}
      {reviewable && (
        <div className="actions">
          <button className="btn approve" disabled={busy} onClick={approve}>Approve &amp; merge</button>
          <button className="btn reject" disabled={busy} onClick={reject}>Reject</button>
        </div>
      )}
      {diffs === null && <p className="empty">Loading diff…</p>}
      {diffs?.length === 0 && <p className="empty">No changes.</p>}
      {diffs?.map((d) => (
        <div key={d.path} className="diff-file">
          <h4>[{d.status}] {d.path}</h4>
          <DiffBody diff={d.diff} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build check.** `cd web && npx vite build && cd ..` — no TS/build errors.

- [ ] **Step 3: Commit.**
```bash
git add -A && git commit -m "feat(web): diff view + approve/reject actions"
```

---

## Task 6: One-command dev + end-to-end verification

**Files:** Modify `package.json`

- [ ] **Step 1: Install** `npm install -D concurrently`

- [ ] **Step 2: Add scripts.**
```bash
npm pkg set scripts.web="vite --config web/vite.config.ts"
npm pkg set scripts.dev="concurrently -n api,web -c blue,green \"npm:api\" \"npm:web\""
npm pkg set scripts.build:web="vite build --config web/vite.config.ts"
```
(Note: vite.config.ts is under web/; `root` defaults to where index.html is. Set `root: 'web'` in vite.config OR run vite with the config's dir. Simplest: in `web/vite.config.ts` add `root: '.'` is implicit when run from web/. To run from repo root with `--config web/vite.config.ts`, add `root: 'web'` to the config. UPDATE web/vite.config.ts to include `root: 'web'` and `build: { outDir: 'dist' }` so `web/dist` is produced.)

Adjust `web/vite.config.ts` to:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  build: { outDir: 'dist', emptyOutDir: true },
});
```

- [ ] **Step 3: End-to-end manual verification** (this is the acceptance test):
  1. `npm run seed` (populate a workspace) — if no proposals exist, run `npm run agent-sim` once to create a submitted proposal.
  2. `npm run dev` — starts API (8787) + web (5173).
  3. Open http://localhost:5173 → click the workspace → click a `submitted` proposal → see colored diff.
  4. Click **Approve & merge** → proposal disappears/refreshes to `merged`; verify via `cd data/repos/<ws> && git log --oneline` that a merge commit landed on main.
  5. Create another proposal (agent-sim), click **Reject** → status `discarded`, main unchanged.

- [ ] **Step 4: Commit.**
```bash
git add -A && git commit -m "chore(web): one-command dev (npm run dev) + build:web"
```

---

## Self-Review

**Spec coverage:** list workspaces (T1 engine + T2 api + T4 ui) ✅ · list proposals (T2/T4) ✅ · view diffs (T2/T5) ✅ · approve=merge with conflict handling (T2 api + T5 ui) ✅ · reject=discard (T2/T5) ✅ · human-only actions live in API/UI, NOT MCP ✅ · serializer guards merge/discard (T2) ✅.

**Type consistency:** `Proposal`/`FileDiff`/`MergeResult` mirrored between engine types and `web/src/api.ts`; route shapes match `api.ts` client; `buildApi(engine, serializer)` signature consistent across T2/T3/test.

**Known deferrals (document, not blocking):** inline-edit of a proposed change before merge; auth; realtime refresh; create-workspace-in-UI. Frontend has no unit tests (manual click-through per mindset doc); API logic is fully TDD'd.

---

## Execution Handoff
Subagent-Driven. Engine/API tasks (1,2) are TDD with vitest; frontend tasks (3,4,5,6) verified by build + manual click-through.
