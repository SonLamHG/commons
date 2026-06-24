import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type InjectOptions } from 'fastify';
import { createEngineRegistry } from '../src/engine/registry.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { buildApi } from '../src/api/server.js';
import { createDb } from '../src/db/index.js';
import { createSession } from '../src/auth/token.js';
import type { GoogleOAuth } from '../src/auth/google.js';
import type { AgentRunner } from '../src/agent/types.js';

const SECRET = 'test-secret';
const APP_URL = 'http://localhost:8787';
const noopGoogle: GoogleOAuth = { authUrl: () => 'https://accounts.google.com', async exchangeCode() { return null; } };

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
    authSecret: SECRET, appUrl: APP_URL, google: noopGoogle, agentRunner,
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
const inj = (opts: InjectOptions & { headers?: Record<string, string> }) =>
  app.inject({ ...opts, headers: { cookie, ...(opts.headers ?? {}) } });

describe('security', () => {
  it('serves security headers and rate-limit on the real API', async () => {
    const res = await inj({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.statusCode).not.toBe(429); // rate-limit hook wired but not tripped
  });
});

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
  it('session probe returns 200 + authenticated:false when signed out', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/session' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ authenticated: false });
  });
  it('session probe returns the user when signed in', async () => {
    const res = await inj({ method: 'GET', url: '/api/auth/session' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ authenticated: true, email: 'owner@example.com' });
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
    const webhookUrl = 'https://93.184.216.34/hook';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      received = JSON.parse((init as RequestInit).body as string);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    try {
      await inj({ method: 'PUT', url: '/api/workspaces/ws1/config', payload: { webhookUrl } });
      const cfg = await inj({ method: 'GET', url: '/api/workspaces/ws1/config' });
      expect(JSON.parse(cfg.payload).webhookUrl).toBe(webhookUrl);

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
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns 400 when no webhook configured', async () => {
    const res = await inj({ method: 'POST', url: '/api/workspaces/ws1/publish', payload: { path: 'items/post-1/post.md' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toMatch(/webhook/i);
  });

  it('returns 502 when the webhook fails', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    try {
      await inj({ method: 'PUT', url: '/api/workspaces/ws1/config', payload: { webhookUrl: 'https://93.184.216.34/nope' } });
      const res = await inj({ method: 'POST', url: '/api/workspaces/ws1/publish', payload: { path: 'items/post-1/post.md' } });
      expect(res.statusCode).toBe(502);
      const pub = await inj({ method: 'GET', url: '/api/workspaces/ws1/published' });
      expect(JSON.parse(pub.payload)['items/post-1/post.md']).toBeUndefined();
    } finally {
      fetchSpy.mockRestore();
    }
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

      await c.app.inject({ method: 'PUT', url: '/api/workspaces/imgpub/config', payload: { webhookUrl: 'https://93.184.216.34/hook' }, headers: { cookie: c.cookie } });
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

      await c.app.inject({ method: 'PUT', url: '/api/workspaces/noimg/config', payload: { webhookUrl: 'https://93.184.216.34/hook' }, headers: { cookie: c.cookie } });
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

  it('rejects a webhook pointing at a private/metadata address (SSRF)', async () => {
    await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'wssrf1', template: 'blank' } });
    const res = await inj({
      method: 'PUT', url: '/api/workspaces/wssrf1/config',
      payload: { webhookUrl: 'https://169.254.169.254/latest/meta-data' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not allowed|https/);
  });

  it('rejects a non-https webhook URL', async () => {
    await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'wssrf2', template: 'blank' } });
    const res = await inj({
      method: 'PUT', url: '/api/workspaces/wssrf2/config',
      payload: { webhookUrl: 'http://example.com/hook' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/https/);
  });
});
