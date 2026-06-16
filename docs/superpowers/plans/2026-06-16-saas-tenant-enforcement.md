# Tenant Enforcement & Auth Wiring (Step 3b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce authentication on the HTTP API and isolate every resource endpoint by tenant — swap the single global engine for `EngineRegistry.forTenant(req.auth.tenantId)`, key all locks with `scopeKey(tenantId, ws)`, scope the publish store per tenant, route the agent at the tenant's storage root, and wire it all together in `main.ts`.

**Architecture:** Step 3b of [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md) (ADR-2 + ADR-3). It consumes Step 1 (`EngineRegistry`, `scopeKey`), Step 2 (`Db`), and Step 3a (`registerAuthRoutes`, `makeRequireAuth`, mailer). `buildApi` changes from positional args to an `ApiDeps` object. A global `preHandler` runs `requireAuth` for every `/api/*` route except `/api/auth/*` and `/api/health`; each resource handler resolves its engine/publish-store from `req.auth.tenantId`. The agent runner now receives the tenant's storage root.

**This step is INVASIVE (not additive):** it rewrites `src/api/server.ts`, `src/api/main.ts`, and `test/api.test.ts`, and changes the `AgentRunner` interface. The test count stays the same for existing behaviour (every request now authenticates via a minted session cookie) plus new isolation/auth tests.

**Important environment note:** the test pipeline runs through `tsx`/esbuild, which **strips types without type-checking** (there is no `tsc` step — see CLAUDE.md). So `npm test` will NOT fail on a type mismatch; correctness is proven by the runtime tests. Keep types correct anyway (strict tsconfig), but rely on the suite for verification.

**Out of scope (later steps):** CORS, rate-limit, helmet, SSRF guard on the webhook, secret encryption (Step 4); agent queue/cost-cap/metering writing to `runs` (Step 5); the web login UI (a thin follow-on — after 3b the SPA gets 401 until a login screen + 401→login redirect exist; track separately). `examples/e2e-real.ts` uses the old `buildApi`/`createClaudeRunner` signatures and is not run by tests — update it in a follow-up.

**Tech Stack:** TypeScript (ESM, tsx), Vitest, Fastify (`app.inject`), the Step 1–3a modules.

---

### Task 1: Route the agent at a tenant root

Make the agent operate on the correct tenant's storage, and make `EngineRegistry.rootFor` return an absolute path (so the agent's MCP child gets a valid `COMMONS_ROOT`).

**Files:**
- Modify: `src/engine/registry.ts`
- Modify: `src/agent/types.ts`
- Modify: `src/agent/runner.ts`

This task keeps the suite green at runtime (the old `server.ts` still calls `run(ws, prompt, write)`; the fake runner in `api.test.ts` ignores extra leading args until Task 2 rewrites both).

- [ ] **Step 1: Make `rootFor` absolute**

In `src/engine/registry.ts`, change the import line:
```ts
import { join } from 'node:path';
```
to:
```ts
import { join, resolve } from 'node:path';
```

And, inside `createEngineRegistry`, add a `resolve` of `rootDir` as the first line of the function body (immediately after the `{`):
```ts
  rootDir = resolve(rootDir);
```

- [ ] **Step 2: Change the `AgentRunner` interface**

In `src/agent/types.ts`, replace the `AgentRunner` interface:
```ts
export interface AgentRunner {
  run(workspace: string, prompt: string, onEvent: (e: AgentEvent) => void): Promise<AgentResult>;
}
```
with:
```ts
export interface AgentRunner {
  run(tenantRoot: string, workspace: string, prompt: string, onEvent: (e: AgentEvent) => void): Promise<AgentResult>;
}
```

- [ ] **Step 3: Update the Claude runner**

Replace the whole body of `src/agent/runner.ts` with:
```ts
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner } from './types.js';
import { buildAgentOptions } from './options.js';
import { toAgentEvent } from './events.js';

/** A runner backed by the Claude Code harness (Agent SDK). The agent's MCP child
 *  is rooted at the caller-supplied tenant storage root, isolating tenants. */
export function createClaudeRunner(): AgentRunner {
  return {
    async run(tenantRoot, workspace, prompt, onEvent) {
      let costUsd = 0;
      let numTurns = 0;
      let ok = false;
      for await (const msg of query({ prompt, options: buildAgentOptions(tenantRoot, workspace) })) {
        for (const e of toAgentEvent(msg)) {
          if (e.type === 'done') { ok = true; costUsd = e.costUsd; numTurns = e.numTurns; }
          onEvent(e);
        }
      }
      return { ok, costUsd, numTurns };
    },
  };
}
```

- [ ] **Step 4: Run the suite to verify nothing regressed**

Run: `npm test`
Expected: PASS — 143 tests (unchanged). `agent-options` tests still pass (`buildAgentOptions` signature unchanged). The old API still works because the fake runner's params shift harmlessly.

- [ ] **Step 5: Commit**

```bash
git add src/engine/registry.ts src/agent/types.ts src/agent/runner.ts
git commit -m "feat(agent): route runner at an absolute tenant storage root"
```
(Append the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.)

---

### Task 2: Tenant-scoped, auth-gated `buildApi` + `main.ts` + test rewrite

The atomic core change. `buildApi` takes `ApiDeps`, mounts auth routes + a global `requireAuth` hook, and resolves engine/publish-store/locks per tenant. `main.ts` wires real deps (secret, db, mailer, invite seeding). `test/api.test.ts` is rewritten to authenticate.

**Files:**
- Rewrite: `src/api/server.ts`
- Rewrite: `src/api/main.ts`
- Rewrite: `test/api.test.ts`

- [ ] **Step 1: Rewrite `src/api/server.ts`**

Replace the entire file with:
```ts
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { posix } from 'node:path';
import type { EngineRegistry } from '../engine/registry.js';
import { WorkspaceSerializer, scopeKey } from '../util/serializer.js';
import { createPublishStore, type PublishStore } from '../publish/store.js';
import type { AgentRunner } from '../agent/types.js';
import type { Db } from '../db/types.js';
import type { Mailer } from '../auth/mailer.js';
import { registerAuthRoutes, makeRequireAuth } from '../auth/routes.js';
import { toPlainText } from '../publish/markdown.js';
import multipart from '@fastify/multipart';
import { extractText, referencePath } from '../upload/extract.js';

function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

/** First Markdown image reference in the post, resolved to a workspace-relative path. */
function firstImagePath(content: string, postPath: string): string | null {
  const m = /!\[[^\]]*\]\(([^)]+)\)/.exec(content);
  if (!m) return null;
  const ref = m[1].trim().split(/\s+/)[0];
  if (/^https?:\/\//i.test(ref) || ref.startsWith('data:')) return null;
  const dir = posix.dirname(postPath.replace(/\\/g, '/'));
  const resolved = posix.normalize(posix.join(dir, ref));
  return resolved.startsWith('..') ? null : resolved;
}

function deriveTitle(content: string, path: string): string {
  const h = content.split('\n').find((l) => l.startsWith('# '));
  return h ? h.replace(/^#\s+/, '').trim() : (path.split('/').pop() ?? path);
}

function buildSeed(template: string, id: string): Record<string, string> {
  const seed: Record<string, string> = {
    'README.md': `# ${id}\n\nA Commons workspace.\n`,
    'reference/README.md':
      '# reference/\n\nSource material the agent reads: briefs, brand voice, notes. ' +
      'User uploads land here. Do not overwrite these.\n',
    'drafts/README.md':
      '# drafts/\n\nContent the agent is drafting. New drafts belong here.\n',
    'published/README.md':
      '# published/\n\nFinalized or published versions, placed here by hand.\n',
    'assets/README.md':
      '# assets/\n\nImages and supporting files.\n',
  };
  if (template === 'content-calendar') {
    seed['brand-voice.md'] = '# Brand voice\n\nDescribe the tone and style here.\n';
    seed['audience.md'] = '# Audience\n\nDescribe who this content is for.\n';
    seed['items/.gitkeep'] = '';
  }
  return seed;
}

type Authed = FastifyRequest & { auth: { userId: string; tenantId: string } };

export interface ApiDeps {
  registry: EngineRegistry;
  serializer: WorkspaceSerializer;
  db: Db;
  authSecret: string;
  appUrl: string;
  mailer: Mailer;
  agentRunner?: AgentRunner;
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const { registry, serializer, db, authSecret, appUrl, mailer, agentRunner } = deps;
  const app = Fastify({ forceCloseConnections: true });
  app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // --- auth: mount routes, then gate everything else under /api ---
  registerAuthRoutes(app, { db, secret: authSecret, appUrl, mailer });
  const requireAuth = makeRequireAuth({ db, secret: authSecret, appUrl, mailer });
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;        // static / SPA
    if (req.url.startsWith('/api/auth/')) return;     // auth endpoints
    if (req.url === '/api/health') return;            // health probe
    return requireAuth(req, reply);
  });

  app.get('/api/health', async () => ({ ok: true }));

  // --- per-tenant resolution helpers (auth has set req.auth) ---
  const tenantOf = (req: FastifyRequest) => (req as Authed).auth.tenantId;
  const engineOf = (req: FastifyRequest) => registry.forTenant(tenantOf(req));
  const publishStores = new Map<string, PublishStore>();
  const publishOf = (req: FastifyRequest): PublishStore => {
    const t = tenantOf(req);
    let s = publishStores.get(t);
    if (!s) { s = createPublishStore(registry.rootFor(t)); publishStores.set(t, s); }
    return s;
  };
  const lock = <T>(req: FastifyRequest, ws: string, fn: () => Promise<T>) =>
    serializer.run(scopeKey(tenantOf(req), ws), fn);

  app.get('/api/workspaces', async (req) => engineOf(req).listWorkspaces());

  app.post('/api/workspaces/:ws/files', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    let text: string;
    try {
      text = await extractText(data.filename, await data.toBuffer());
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
    const path = referencePath(data.filename);
    await lock(req, ws, () => engineOf(req).addFile(ws, path, text));
    return reply.code(201).send({ path });
  });

  app.post('/api/workspaces', async (req, reply) => {
    const { id, template } = (req.body ?? {}) as { id?: string; template?: string };
    if (!id) return reply.code(400).send({ error: 'id required' });
    try {
      await lock(req, id, () => engineOf(req).createWorkspace({ id, seed: buildSeed(template ?? 'blank', id) }));
      return reply.code(201).send({ id });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/workspaces/:ws', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const workspaces = await engineOf(req).listWorkspaces();
    if (!workspaces.includes(ws)) return reply.code(404).send({ error: `workspace '${ws}' not found` });
    try {
      await lock(req, ws, () => engineOf(req).deleteWorkspace(ws));
      return reply.code(200).send({ deleted: ws });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/proposals', async (req) => {
    const { ws } = req.params as { ws: string };
    return engineOf(req).listProposals(ws);
  });

  app.get('/api/workspaces/:ws/proposals/:id/diff', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return engineOf(req).diffProposal(ws, id);
  });

  app.get('/api/workspaces/:ws/proposals/:id/file', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      return { path, content: await engineOf(req).readProposalFile(ws, id, path) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/state', async (req) => {
    const { ws } = req.params as { ws: string };
    return engineOf(req).readState(ws);
  });

  app.get('/api/workspaces/:ws/asset', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      const bytes = await engineOf(req).readFileBytes(ws, path);
      return reply.type(mimeForPath(path)).send(bytes);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/proposals/:id/asset', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      const bytes = await engineOf(req).readProposalFileBytes(ws, id, path);
      return reply.type(mimeForPath(path)).send(bytes);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/workspaces/:ws/file', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      await lock(req, ws, () => engineOf(req).deleteFile(ws, path));
      return { deleted: true, path };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/file', async (req) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) throw new Error('path query param required');
    return { path, content: await engineOf(req).readFile(ws, path) };
  });

  app.post('/api/workspaces/:ws/proposals/:id/approve', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return lock(req, ws, () => engineOf(req).mergeProposal(ws, id));
  });

  app.post('/api/workspaces/:ws/proposals/:id/reject', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    await lock(req, ws, () => engineOf(req).discardProposal(ws, id));
    return reply.send({ discarded: true });
  });

  app.get('/api/workspaces/:ws/config', async (req) => {
    const { ws } = req.params as { ws: string };
    return publishOf(req).getConfig(ws);
  });

  app.put('/api/workspaces/:ws/config', async (req) => {
    const { ws } = req.params as { ws: string };
    const { webhookUrl } = (req.body ?? {}) as { webhookUrl?: string };
    await lock(req, ws, async () => publishOf(req).setConfig(ws, { webhookUrl }));
    return { ok: true };
  });

  app.get('/api/workspaces/:ws/published', async (req) => {
    const { ws } = req.params as { ws: string };
    return publishOf(req).listPublished(ws);
  });

  app.post('/api/workspaces/:ws/publish', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path required' });
    const { webhookUrl } = publishOf(req).getConfig(ws);
    if (!webhookUrl) return reply.code(400).send({ error: 'no webhook configured for this workspace' });

    let content: string;
    try { content = await engineOf(req).readFile(ws, path); }
    catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }); }

    const title = deriveTitle(content, path);
    const text = toPlainText(content);

    let image: { filename: string; mime: string; base64: string } | undefined;
    const imgPath = firstImagePath(content, path);
    if (imgPath) {
      try {
        const bytes = await engineOf(req).readFileBytes(ws, imgPath);
        image = {
          filename: imgPath.split('/').pop() ?? 'image',
          mime: mimeForPath(imgPath),
          base64: bytes.toString('base64'),
        };
      } catch { /* image referenced but missing — publish text-only */ }
    }

    try {
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: ws, path, title, content, text, ...(image ? { image } : {}) }),
      });
      if (!r.ok) return reply.code(502).send({ error: `webhook returned ${r.status}` });
    } catch (e) {
      return reply.code(502).send({ error: `webhook failed: ${e instanceof Error ? e.message : String(e)}` });
    }

    const rec = await lock(req, ws, async () => publishOf(req).markPublished(ws, path));
    return { published: true, publishedAt: rec.publishedAt, title };
  });

  app.post('/api/workspaces/:ws/agent', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    if (!/^[A-Za-z0-9_-]+$/.test(ws)) return reply.code(400).send({ error: 'invalid workspace id' });
    const workspaces = await engineOf(req).listWorkspaces();
    if (!workspaces.includes(ws)) return reply.code(404).send({ error: `workspace '${ws}' not found` });
    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || !prompt.trim()) return reply.code(400).send({ error: 'prompt required' });
    if (!agentRunner) return reply.code(503).send({ error: 'agent not configured on this server' });

    reply.header('content-type', 'application/x-ndjson');
    const stream = new Readable({ read() {} });
    const write = (e: unknown) => stream.push(JSON.stringify(e) + '\n');
    agentRunner
      .run(registry.rootFor(tenantOf(req)), ws, prompt, write)
      .catch((e) => write({ type: 'error', message: e instanceof Error ? e.message : String(e) }))
      .finally(() => stream.push(null));
    return reply.send(stream);
  });

  return app;
}
```

- [ ] **Step 2: Rewrite `src/api/main.ts`**

Replace the entire file with:
```ts
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { createEngineRegistry } from '../engine/registry.js';
import { WorkspaceSerializer } from '../util/serializer.js';
import { buildApi } from './server.js';
import { createDb } from '../db/index.js';
import { createClaudeRunner } from '../agent/runner.js';
import { mailerFromEnv } from '../auth/mailer.js';
import { loadEnv } from '../util/env.js';

loadEnv(); // pick up secrets/env from a project-root .env before reading process.env

const root = resolve(process.env.COMMONS_ROOT ?? join(process.cwd(), 'data'));
const port = Number(process.env.PORT ?? 8787);
const appUrl = process.env.COMMONS_APP_URL ?? `http://localhost:${port}`;

const authSecret = process.env.COMMONS_AUTH_SECRET;
if (!authSecret) {
  process.stderr.write('COMMONS_AUTH_SECRET is required (set it in .env) — refusing to start.\n');
  process.exit(1);
}

const db = createDb(join(root, 'commons.db'));

// Beta allowlist: seed invited emails from COMMONS_INVITES (comma-separated).
for (const email of (process.env.COMMONS_INVITES ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  db.addInvite(email);
}

const app = buildApi({
  registry: createEngineRegistry(root),
  serializer: new WorkspaceSerializer(),
  db,
  authSecret,
  appUrl,
  mailer: mailerFromEnv(),
  agentRunner: createClaudeRunner(),
});

const dist = join(process.cwd(), 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found', path: req.url });
    return reply.sendFile('index.html');
  });
}

app.listen({ port, host: '0.0.0.0' })
  .then(() => process.stdout.write(`commons review UI on http://localhost:${port}\n`))
  .catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      process.stderr.write(`port ${port} is already in use — is another api process still running?\n`);
    } else {
      process.stderr.write(String(e) + '\n');
    }
    process.exit(1);
  });

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  process.stderr.write(`\n${signal} received — closing server…\n`);
  try {
    await app.close();
    process.exit(0);
  } catch (e) {
    process.stderr.write(String(e) + '\n');
    process.exit(1);
  }
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig));
}
```

- [ ] **Step 3: Rewrite `test/api.test.ts`**

Replace the entire file with:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { createEngineRegistry } from '../src/engine/registry.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { buildApi } from '../src/api/server.js';
import { createDb } from '../src/db/index.js';
import { createSession } from '../src/auth/token.js';
import type { Mailer } from '../src/auth/mailer.js';
import type { AgentRunner } from '../src/agent/types.js';

const SECRET = 'test-secret';
const APP_URL = 'http://localhost:8787';
const noopMailer: Mailer = { async send() {} };

/** Build an authenticated app over `root` with a single tenant + session cookie. */
function setup(root: string, agentRunner?: AgentRunner) {
  const registry = createEngineRegistry(root);
  const db = createDb(':memory:');
  const tenantId = 't-test';
  db.createTenant(tenantId);
  const user = db.createUser('owner@example.com', tenantId);
  const cookie = `commons_session=${createSession(user.id, SECRET)}`;
  const app = buildApi({
    registry, serializer: new WorkspaceSerializer(), db,
    authSecret: SECRET, appUrl: APP_URL, mailer: noopMailer, agentRunner,
  });
  return { registry, db, tenantId, user, cookie, app, engine: registry.forTenant(tenantId) };
}

let root: string;
let ctx: ReturnType<typeof setup>;
let app: ReturnType<typeof buildApi>;
let cookie: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'commons-api-'));
  ctx = setup(root);
  app = ctx.app;
  cookie = ctx.cookie;
  const engine = ctx.engine;
  await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello', 'items/post-1/post.md': '# Hello World\n\nBody text here.\n' } });
  await engine.createProposal('ws1', { id: 'p1', title: 'Add b' });
  await engine.writeProposalFile('ws1', 'p1', 'b.md', 'bee');
  await engine.submitProposal('ws1', 'p1', 'add b');
});
afterEach(async () => {
  await app.close();
  ctx.db.close();
  rmSync(root, { recursive: true, force: true });
});

const json = (r: { payload: string }) => JSON.parse(r.payload);
/** inject with the session cookie attached (auth required on every /api route). */
const inj = (opts: Parameters<typeof app.inject>[0] & { headers?: Record<string, string> }) =>
  app.inject({ ...opts, headers: { cookie, ...(opts.headers ?? {}) } });

describe('auth gate', () => {
  it('rejects an unauthenticated API request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(401);
  });
  it('allows the health probe without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true });
  });
});

describe('API', () => {
  it('GET /api/workspaces lists workspaces', async () => {
    const res = await inj({ method: 'GET', url: '/api/workspaces' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual(['ws1']);
  });
  it('GET proposals lists proposals', async () => {
    const res = await inj({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(res)[0]).toMatchObject({ id: 'p1', status: 'submitted', title: 'Add b' });
  });
  it('GET diff returns per-file diffs', async () => {
    const res = await inj({ method: 'GET', url: '/api/workspaces/ws1/proposals/p1/diff' });
    expect(json(res).find((d: any) => d.path === 'b.md').status).toBe('added');
  });
  it('GET proposal file returns the proposed (final) content', async () => {
    const res = await inj({ method: 'GET', url: '/api/workspaces/ws1/proposals/p1/file?path=b.md' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ path: 'b.md', content: 'bee' });
  });
  it('POST approve merges', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces/ws1/proposals/p1/approve' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ merged: true });
    const list = await inj({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(list)[0].status).toBe('merged');
  });
  it('POST reject discards', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces/ws1/proposals/p1/reject' });
    expect(res.statusCode).toBe(200);
    const list = await inj({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(list)[0].status).toBe('discarded');
  });

  it('GET state returns the approved file tree', async () => {
    const res = await inj({ method: 'GET', url: '/api/workspaces/ws1/state' });
    expect(res.statusCode).toBe(200);
    expect(json(res).find((n: any) => n.path === 'a.md' && n.type === 'file')).toBeTruthy();
  });

  it('GET file returns file content', async () => {
    const res = await inj({ method: 'GET', url: '/api/workspaces/ws1/file?path=a.md' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ path: 'a.md', content: 'hello' });
  });

  it('POST files uploads source material into reference/ and writes to main', async () => {
    const boundary = '----commonsTest';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="June Brief.txt"\r\nContent-Type: text/plain\r\n\r\n`),
      Buffer.from('Launch the campaign in June.'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await inj({
      method: 'POST', url: '/api/workspaces/ws1/files',
      payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(201);
    expect(json(res)).toEqual({ path: 'reference/June Brief.md' });
    const file = await inj({ method: 'GET', url: '/api/workspaces/ws1/file?path=reference/June Brief.md' });
    expect(json(file).content).toBe('Launch the campaign in June.');
  });

  it('DELETE file removes it from main', async () => {
    const del = await inj({ method: 'DELETE', url: '/api/workspaces/ws1/file?path=a.md' });
    expect(del.statusCode).toBe(200);
    expect(json(del)).toEqual({ deleted: true, path: 'a.md' });
    const state = await inj({ method: 'GET', url: '/api/workspaces/ws1/state' });
    expect(json(state).find((n: any) => n.path === 'a.md')).toBeUndefined();
  });

  it('DELETE missing file returns 400', async () => {
    const del = await inj({ method: 'DELETE', url: '/api/workspaces/ws1/file?path=nope.md' });
    expect(del.statusCode).toBe(400);
    expect(json(del).error).toMatch(/not found/);
  });

  it('POST files rejects unsupported types', async () => {
    const boundary = '----commonsTest2';
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.from('\x89PNG\r\n'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await inj({
      method: 'POST', url: '/api/workspaces/ws1/files',
      payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toMatch(/unsupported/);
  });

  it('POST creates a new workspace (blank template) and it appears in the list', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'fresh', template: 'blank' } });
    expect(res.statusCode).toBe(201);
    expect(json(res)).toEqual({ id: 'fresh' });
    const list = await inj({ method: 'GET', url: '/api/workspaces' });
    expect(json(list)).toContain('fresh');
    const state = await inj({ method: 'GET', url: '/api/workspaces/fresh/state' });
    expect(json(state).some((n: any) => n.path === 'README.md')).toBe(true);
  });

  it('seeds the four standard role folders', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'folders-ws', template: 'blank' } });
    expect(res.statusCode).toBe(201);
    const state = await inj({ method: 'GET', url: '/api/workspaces/folders-ws/state' });
    const paths = (state.json() as { path: string }[]).map((n) => n.path);
    expect(paths).toContain('reference/README.md');
    expect(paths).toContain('drafts/README.md');
    expect(paths).toContain('published/README.md');
    expect(paths).toContain('assets/README.md');
  });

  it('POST content-calendar template seeds starter files', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'cal', template: 'content-calendar' } });
    expect(res.statusCode).toBe(201);
    const state = json(await inj({ method: 'GET', url: '/api/workspaces/cal/state' }));
    const paths = state.map((n: any) => n.path);
    expect(paths).toContain('brand-voice.md');
    expect(paths).toContain('audience.md');
  });

  it('POST rejects a duplicate workspace id with 400', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'ws1', template: 'blank' } });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toMatch(/already exists/);
  });

  it('POST rejects an invalid id with 400', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'bad id', template: 'blank' } });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toMatch(/invalid/);
  });

  it('DELETE removes a workspace and it disappears from the list', async () => {
    const res = await inj({ method: 'DELETE', url: '/api/workspaces/ws1' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ deleted: 'ws1' });
    const list = await inj({ method: 'GET', url: '/api/workspaces' });
    expect(json(list)).not.toContain('ws1');
  });

  it('DELETE returns 404 for an unknown workspace', async () => {
    const res = await inj({ method: 'DELETE', url: '/api/workspaces/nope' });
    expect(res.statusCode).toBe(404);
    expect(json(res).error).toMatch(/not found/);
  });

  it('POST agent streams events and creates a proposal (fake runner)', async () => {
    const r = mkdtempSync(join(tmpdir(), 'commons-agent-'));
    const fakeRunner: AgentRunner = {
      run: async (_root, _ws, _prompt, onEvent) => {
        onEvent({ type: 'text', text: 'Drafting…' });
        onEvent({ type: 'tool', name: 'mcp__commons__create_proposal' });
        onEvent({ type: 'done', result: 'Submitted.', costUsd: 0.01, numTurns: 3 });
        return { ok: true, costUsd: 0.01, numTurns: 3 };
      },
    };
    const c = setup(r, fakeRunner);
    await c.engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    try {
      const res = await c.app.inject({
        method: 'POST', url: '/api/workspaces/ws1/agent',
        payload: { prompt: 'write a post' },
        headers: { cookie: c.cookie, 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      const events = res.payload.trim().split('\n').map((l) => JSON.parse(l));
      expect(events[0]).toEqual({ type: 'text', text: 'Drafting…' });
      expect(events.find((e: any) => e.type === 'done')).toBeTruthy();
    } finally {
      await c.app.close();
      c.db.close();
      rmSync(r, { recursive: true, force: true });
    }
  });

  it('POST agent returns 400 when prompt is missing', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces/ws1/agent', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('serves a merged image as bytes with the right content-type', async () => {
    const r = mkdtempSync(join(tmpdir(), 'commons-img-'));
    const c = setup(r);
    try {
      await c.engine.createWorkspace({ id: 'imgws', seed: { 'README.md': '# x\n' } });
      await c.engine.createProposal('imgws', { id: 'p1', title: 't' });
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
      await c.engine.writeProposalFileBytes('imgws', 'p1', 'assets/c.png', png);
      await c.engine.submitProposal('imgws', 'p1', 'add');
      await c.engine.mergeProposal('imgws', 'p1');

      const res = await c.app.inject({ method: 'GET', url: '/api/workspaces/imgws/asset?path=assets/c.png', headers: { cookie: c.cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(Buffer.compare(res.rawPayload, png)).toBe(0);
    } finally {
      await c.app.close();
      c.db.close();
      rmSync(r, { recursive: true, force: true });
    }
  });

  it('serves a proposal image as bytes with the right content-type', async () => {
    const r = mkdtempSync(join(tmpdir(), 'commons-img2-'));
    const c = setup(r);
    try {
      await c.engine.createWorkspace({ id: 'imgws2', seed: { 'README.md': '# x\n' } });
      await c.engine.createProposal('imgws2', { id: 'p2', title: 't' });
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
      await c.engine.writeProposalFileBytes('imgws2', 'p2', 'assets/d.png', png);

      const res = await c.app.inject({ method: 'GET', url: '/api/workspaces/imgws2/proposals/p2/asset?path=assets/d.png', headers: { cookie: c.cookie } });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('image/png');
      expect(Buffer.compare(res.rawPayload, png)).toBe(0);
    } finally {
      await c.app.close();
      c.db.close();
      rmSync(r, { recursive: true, force: true });
    }
  });
});

describe('publish', () => {
  let receiver: ReturnType<typeof Fastify>;
  let receiverUrl: string;
  let received: any;

  beforeEach(async () => {
    received = null;
    receiver = Fastify();
    receiver.post('/hook', async (req: import('fastify').FastifyRequest) => { received = req.body; return { ok: true }; });
    const addr = await receiver.listen({ port: 0, host: '127.0.0.1' });
    receiverUrl = addr + '/hook';
  });
  afterEach(async () => { await receiver.close(); });

  it('PUT config then publish posts content to the webhook and marks published', async () => {
    await inj({ method: 'PUT', url: '/api/workspaces/ws1/config', payload: { webhookUrl: receiverUrl } });
    const cfg = await inj({ method: 'GET', url: '/api/workspaces/ws1/config' });
    expect(JSON.parse(cfg.payload).webhookUrl).toBe(receiverUrl);

    const res = await inj({ method: 'POST', url: '/api/workspaces/ws1/publish', payload: { path: 'items/post-1/post.md' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).published).toBe(true);

    expect(received).toMatchObject({ workspace: 'ws1', path: 'items/post-1/post.md', title: 'Hello World' });
    expect(received.content).toContain('Body text');
    expect(received.text).toContain('Hello World');
    expect(received.text).toContain('Body text');
    expect(received.text).not.toContain('#');

    const pub = await inj({ method: 'GET', url: '/api/workspaces/ws1/published' });
    expect(JSON.parse(pub.payload)['items/post-1/post.md']).toBeDefined();
  });

  it('returns 400 when no webhook configured', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces/ws1/publish', payload: { path: 'items/post-1/post.md' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toMatch(/webhook/i);
  });

  it('returns 502 when the webhook fails', async () => {
    await inj({ method: 'PUT', url: '/api/workspaces/ws1/config', payload: { webhookUrl: 'http://127.0.0.1:1/nope' } });
    const res = await inj({ method: 'POST', url: '/api/workspaces/ws1/publish', payload: { path: 'items/post-1/post.md' } });
    expect(res.statusCode).toBe(502);
    const pub = await inj({ method: 'GET', url: '/api/workspaces/ws1/published' });
    expect(JSON.parse(pub.payload)['items/post-1/post.md']).toBeUndefined();
  });

  it('attaches the first image as base64 in the webhook payload', async () => {
    const r = mkdtempSync(join(tmpdir(), 'commons-pub-img-'));
    const c = setup(r);
    try {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 5, 5, 5]);
      await c.engine.createWorkspace({ id: 'imgpub', seed: { 'README.md': '# x\n' } });
      await c.engine.createProposal('imgpub', { id: 'pp', title: 'add post' });
      await c.engine.writeProposalFile('imgpub', 'pp', 'items/post.md', '# Hi\n\n![cover](../assets/cover.png)\n');
      await c.engine.writeProposalFileBytes('imgpub', 'pp', 'assets/cover.png', png);
      await c.engine.submitProposal('imgpub', 'pp', 'add post');
      await c.engine.mergeProposal('imgpub', 'pp');

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      await c.app.inject({ method: 'PUT', url: '/api/workspaces/imgpub/config', payload: { webhookUrl: 'https://example.com/hook' }, headers: { cookie: c.cookie } });
      const res = await c.app.inject({ method: 'POST', url: '/api/workspaces/imgpub/publish', payload: { path: 'items/post.md' }, headers: { cookie: c.cookie } });

      expect(res.statusCode).toBe(200);
      const callArgs = fetchSpy.mock.calls[0];
      const capturedBody = JSON.parse((callArgs![1] as RequestInit).body as string);

      expect(capturedBody.image).toBeDefined();
      expect(capturedBody.image.mime).toBe('image/png');
      expect(capturedBody.image.filename).toBe('cover.png');
      expect(Buffer.from(capturedBody.image.base64, 'base64').length).toBe(png.length);

      fetchSpy.mockRestore();
    } finally {
      await c.app.close();
      c.db.close();
      rmSync(r, { recursive: true, force: true });
    }
  });

  it('sends no image field when post has no image reference', async () => {
    const r = mkdtempSync(join(tmpdir(), 'commons-pub-noimg-'));
    const c = setup(r);
    try {
      await c.engine.createWorkspace({ id: 'noimg', seed: { 'items/post.md': '# Plain\n\nNo images here.\n' } });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      await c.app.inject({ method: 'PUT', url: '/api/workspaces/noimg/config', payload: { webhookUrl: 'https://example.com/hook' }, headers: { cookie: c.cookie } });
      const res = await c.app.inject({ method: 'POST', url: '/api/workspaces/noimg/publish', payload: { path: 'items/post.md' }, headers: { cookie: c.cookie } });

      expect(res.statusCode).toBe(200);
      const callArgs = fetchSpy.mock.calls[0];
      const capturedBody = JSON.parse((callArgs![1] as RequestInit).body as string);
      expect(capturedBody.image).toBeUndefined();

      fetchSpy.mockRestore();
    } finally {
      await c.app.close();
      c.db.close();
      rmSync(r, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS — all suites green. `api.test.ts` now has its original cases (re-pointed through `inj`) plus 2 new `auth gate` tests. Total ≈ **145 tests**, 21 files. If a test fails, fix the wiring before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts src/api/main.ts test/api.test.ts
git commit -m "feat(api): enforce auth and tenant-scope every endpoint"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 3: Cross-tenant isolation tests + mark step 3 done

**Files:**
- Create: `test/api-tenant-isolation.test.ts`
- Modify: `SAAS_BETA_ARCHITECTURE.md`

- [ ] **Step 1: Write the isolation tests**

Create `test/api-tenant-isolation.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineRegistry } from '../src/engine/registry.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { buildApi } from '../src/api/server.js';
import { createDb } from '../src/db/index.js';
import { createSession } from '../src/auth/token.js';
import type { Mailer } from '../src/auth/mailer.js';

const SECRET = 'test-secret';
const noop: Mailer = { async send() {} };
const json = (r: { payload: string }) => JSON.parse(r.payload);

let root: string;
let db: ReturnType<typeof createDb>;
let app: ReturnType<typeof buildApi>;
let cookieA: string;
let cookieB: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'commons-iso-'));
  const registry = createEngineRegistry(root);
  db = createDb(':memory:');
  db.createTenant('tenantA');
  db.createTenant('tenantB');
  const a = db.createUser('a@x.com', 'tenantA');
  const b = db.createUser('b@x.com', 'tenantB');
  cookieA = `commons_session=${createSession(a.id, SECRET)}`;
  cookieB = `commons_session=${createSession(b.id, SECRET)}`;
  app = buildApi({ registry, serializer: new WorkspaceSerializer(), db, authSecret: SECRET, appUrl: 'http://localhost:8787', mailer: noop });

  // tenant A owns a workspace called "shared"
  await registry.forTenant('tenantA').createWorkspace({ id: 'shared', seed: { 'a.md': 'A-only' } });
});
afterEach(async () => { await app.close(); db.close(); rmSync(root, { recursive: true, force: true }); });

describe('tenant isolation', () => {
  it('a tenant only sees its own workspaces', async () => {
    const listA = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: cookieA } });
    expect(json(listA)).toEqual(['shared']);

    const listB = await app.inject({ method: 'GET', url: '/api/workspaces', headers: { cookie: cookieB } });
    expect(json(listB)).toEqual([]);
  });

  it('two tenants can hold the same workspace id independently', async () => {
    const create = await app.inject({
      method: 'POST', url: '/api/workspaces',
      payload: { id: 'shared', template: 'blank' },
      headers: { cookie: cookieB, 'content-type': 'application/json' },
    });
    expect(create.statusCode).toBe(201);

    const fileA = await app.inject({ method: 'GET', url: '/api/workspaces/shared/file?path=a.md', headers: { cookie: cookieA } });
    expect(json(fileA).content).toBe('A-only');

    // tenant B's "shared" is the blank template — it has README.md, not a.md
    const stateB = await app.inject({ method: 'GET', url: '/api/workspaces/shared/state', headers: { cookie: cookieB } });
    const pathsB = (json(stateB) as { path: string }[]).map((n) => n.path);
    expect(pathsB).toContain('README.md');
    expect(pathsB).not.toContain('a.md');
  });
});
```

- [ ] **Step 2: Run the suite**

Run: `npm test`
Expected: PASS — adds 2 isolation tests → ≈ **147 tests**, 22 files.

- [ ] **Step 3: Mark step 3 done in the architecture doc**

In [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md), under "Thứ tự xây", change:
```
3. **Auth invite-only + đóng endpoint theo tenant** ...
```
(whatever the current line 3 text is) to begin with `3. ✅ **Auth invite-only ...`. If the line does not already note 3a/3b, set it to:
```
3. ✅ **Auth invite-only + đóng endpoint theo tenant** (ADR-3): magic-link (3a) + enforce/tenant-scope (3b).
```

- [ ] **Step 4: Commit**

```bash
git add test/api-tenant-isolation.test.ts SAAS_BETA_ARCHITECTURE.md docs/superpowers/plans/2026-06-16-saas-tenant-enforcement.md
git commit -m "test(api): cross-tenant isolation; mark step 3 complete"
```
(Append the `Co-Authored-By` trailer.)

---

## Self-Review

**Spec coverage (vs ADR-2/ADR-3 + build-order step 3):**
- "đóng mọi endpoint theo tenant" → global `requireAuth` hook + `engineOf(req)`/`publishOf(req)`/`scopeKey` per request (Task 2) ✓
- "serializer key theo tenant" → `lock(req, ws, …)` = `serializer.run(scopeKey(tenantId, ws), …)` (Task 2) ✓
- "thread tenant vào agent" → `agentRunner.run(registry.rootFor(tenantId), …)` + interface change (Task 1+2) ✓
- "wire main.ts (COMMONS_AUTH_SECRET/COMMONS_APP_URL, db+mailer)" → Task 2 main.ts, plus `COMMONS_INVITES` allowlist seeding ✓
- "cập nhật api.test.ts" → full rewrite with auth (Task 2) ✓
- isolation proof → Task 3 ✓

**Out of scope (later steps, intentional):** CORS/rate-limit/helmet/SSRF/secret-encryption (Step 4); agent queue/cost-cap/metering (Step 5); web login UI + 401→login redirect (follow-on); `examples/e2e-real.ts` update (not test-covered).

**Placeholder scan:** none — full file contents and exact commands provided.

**Type/shape consistency:** `ApiDeps { registry, serializer, db, authSecret, appUrl, mailer, agentRunner? }` is the exact object passed by `setup()` in `test/api.test.ts`, the isolation test, and `main.ts`. `AgentRunner.run(tenantRoot, workspace, prompt, onEvent)` matches the new interface (Task 1), the route call `agentRunner.run(registry.rootFor(tenantOf(req)), ws, prompt, write)` (Task 2), and the fake runner `run: async (_root, _ws, _prompt, onEvent) => …` (Task 2 test). `registry.rootFor`/`registry.forTenant` come from Step 1; `scopeKey` from Step 1; `createSession` from Step 3a (`token.ts`); `registerAuthRoutes`/`makeRequireAuth` from Step 3a. The session cookie name `commons_session` matches `routes.ts`. `req.auth = { userId, tenantId }` is set by `makeRequireAuth` and read by `tenantOf`.
```
