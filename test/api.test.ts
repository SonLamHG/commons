import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { createEngine } from '../src/engine/index.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { buildApi } from '../src/api/server.js';
import { createPublishStore } from '../src/publish/store.js';

let root: string;
let app: ReturnType<typeof buildApi>;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'commons-api-'));
  const engine = createEngine(root);
  await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello', 'items/post-1/post.md': '# Hello World\n\nBody text here.\n' } });
  await engine.createProposal('ws1', { id: 'p1', title: 'Add b' });
  await engine.writeProposalFile('ws1', 'p1', 'b.md', 'bee');
  await engine.submitProposal('ws1', 'p1', 'add b');
  app = buildApi(engine, new WorkspaceSerializer(), createPublishStore(root));
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
  it('GET proposals lists proposals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(res)[0]).toMatchObject({ id: 'p1', status: 'submitted', title: 'Add b' });
  });
  it('GET diff returns per-file diffs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals/p1/diff' });
    expect(json(res).find((d: any) => d.path === 'b.md').status).toBe('added');
  });
  it('GET proposal file returns the proposed (final) content', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals/p1/file?path=b.md' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ path: 'b.md', content: 'bee' });
  });
  it('POST approve merges', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/proposals/p1/approve' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ merged: true });
    const list = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(list)[0].status).toBe('merged');
  });
  it('POST reject discards', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/proposals/p1/reject' });
    expect(res.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(list)[0].status).toBe('discarded');
  });

  it('GET state returns the approved file tree', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/state' });
    expect(res.statusCode).toBe(200);
    const nodes = json(res);
    expect(nodes.find((n: any) => n.path === 'a.md' && n.type === 'file')).toBeTruthy();
  });

  it('GET file returns file content', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/file?path=a.md' });
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
    const res = await app.inject({
      method: 'POST', url: '/api/workspaces/ws1/files',
      payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(201);
    expect(json(res)).toEqual({ path: 'reference/June Brief.md' });

    // It is now durable main state, readable by agents.
    const file = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/file?path=reference/June Brief.md' });
    expect(json(file).content).toBe('Launch the campaign in June.');
  });

  it('DELETE file removes it from main', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/workspaces/ws1/file?path=a.md' });
    expect(del.statusCode).toBe(200);
    expect(json(del)).toEqual({ deleted: true, path: 'a.md' });
    const state = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/state' });
    expect(json(state).find((n: any) => n.path === 'a.md')).toBeUndefined();
  });

  it('DELETE missing file returns 400', async () => {
    const del = await app.inject({ method: 'DELETE', url: '/api/workspaces/ws1/file?path=nope.md' });
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
    const res = await app.inject({
      method: 'POST', url: '/api/workspaces/ws1/files',
      payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toMatch(/unsupported/);
  });

  it('POST creates a new workspace (blank template) and it appears in the list', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces', payload: { id: 'fresh', template: 'blank' } });
    expect(res.statusCode).toBe(201);
    expect(json(res)).toEqual({ id: 'fresh' });
    const list = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(json(list)).toContain('fresh');
    const state = await app.inject({ method: 'GET', url: '/api/workspaces/fresh/state' });
    expect(json(state).some((n: any) => n.path === 'README.md')).toBe(true);
  });

  it('seeds the four standard role folders', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/workspaces',
      payload: { id: 'folders-ws', template: 'blank' },
    });
    expect(res.statusCode).toBe(201);

    const state = await app.inject({ method: 'GET', url: '/api/workspaces/folders-ws/state' });
    const paths = (state.json() as { path: string }[]).map((n) => n.path);
    expect(paths).toContain('reference/README.md');
    expect(paths).toContain('drafts/README.md');
    expect(paths).toContain('published/README.md');
    expect(paths).toContain('assets/README.md');
  });

  it('POST content-calendar template seeds starter files', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces', payload: { id: 'cal', template: 'content-calendar' } });
    expect(res.statusCode).toBe(201);
    const state = json(await app.inject({ method: 'GET', url: '/api/workspaces/cal/state' }));
    const paths = state.map((n: any) => n.path);
    expect(paths).toContain('brand-voice.md');
    expect(paths).toContain('audience.md');
  });

  it('POST rejects a duplicate workspace id with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces', payload: { id: 'ws1', template: 'blank' } });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toMatch(/already exists/);
  });

  it('POST rejects an invalid id with 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces', payload: { id: 'bad id', template: 'blank' } });
    expect(res.statusCode).toBe(400);
    expect(json(res).error).toMatch(/invalid/);
  });

  it('DELETE removes a workspace and it disappears from the list', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/ws1' });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ deleted: 'ws1' });
    const list = await app.inject({ method: 'GET', url: '/api/workspaces' });
    expect(json(list)).not.toContain('ws1');
  });

  it('DELETE returns 404 for an unknown workspace', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/workspaces/nope' });
    expect(res.statusCode).toBe(404);
    expect(json(res).error).toMatch(/not found/);
  });

  it('POST agent streams events and creates a proposal (fake runner)', async () => {
    const { createEngine } = await import('../src/engine/index.js');
    const { WorkspaceSerializer } = await import('../src/util/serializer.js');
    const { createPublishStore } = await import('../src/publish/store.js');
    const r = mkdtempSync(join(tmpdir(), 'commons-agent-'));
    const engine2 = createEngine(r);
    await engine2.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });

    const fakeRunner = {
      run: async (_ws: string, _prompt: string, onEvent: (e: any) => void) => {
        onEvent({ type: 'text', text: 'Drafting…' });
        onEvent({ type: 'tool', name: 'mcp__commons__create_proposal' });
        onEvent({ type: 'done', result: 'Submitted.', costUsd: 0.01, numTurns: 3 });
        return { ok: true, costUsd: 0.01, numTurns: 3 };
      },
    };
    const a = buildApi(engine2, new WorkspaceSerializer(), createPublishStore(r), fakeRunner);
    try {
      const res = await a.inject({
        method: 'POST', url: '/api/workspaces/ws1/agent',
        payload: { prompt: 'write a post' }, headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(200);
      const events = res.payload.trim().split('\n').map((l) => JSON.parse(l));
      expect(events[0]).toEqual({ type: 'text', text: 'Drafting…' });
      expect(events.find((e: any) => e.type === 'done')).toBeTruthy();
    } finally {
      await a.close();
      rmSync(r, { recursive: true, force: true });
    }
  });

  it('POST agent returns 400 when prompt is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/agent', payload: {} });
    expect(res.statusCode).toBe(400);
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
    await app.inject({ method: 'PUT', url: '/api/workspaces/ws1/config', payload: { webhookUrl: receiverUrl } });
    const cfg = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/config' });
    expect(JSON.parse(cfg.payload).webhookUrl).toBe(receiverUrl);

    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/publish', payload: { path: 'items/post-1/post.md' } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).published).toBe(true);

    expect(received).toMatchObject({ workspace: 'ws1', path: 'items/post-1/post.md', title: 'Hello World' });
    expect(received.content).toContain('Body text');
    // plain-text rendition for social posts: markdown markers stripped
    expect(received.text).toContain('Hello World');
    expect(received.text).toContain('Body text');
    expect(received.text).not.toContain('#');

    const pub = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/published' });
    expect(JSON.parse(pub.payload)['items/post-1/post.md']).toBeDefined();
  });

  it('returns 400 when no webhook configured', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/publish', payload: { path: 'items/post-1/post.md' } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toMatch(/webhook/i);
  });

  it('returns 502 when the webhook fails', async () => {
    await app.inject({ method: 'PUT', url: '/api/workspaces/ws1/config', payload: { webhookUrl: 'http://127.0.0.1:1/nope' } });
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/publish', payload: { path: 'items/post-1/post.md' } });
    expect(res.statusCode).toBe(502);
    // not marked published on failure
    const pub = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/published' });
    expect(JSON.parse(pub.payload)['items/post-1/post.md']).toBeUndefined();
  });
});
