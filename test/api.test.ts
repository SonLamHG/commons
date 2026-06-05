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
  it('GET proposals lists proposals', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals' });
    expect(json(res)[0]).toMatchObject({ id: 'p1', status: 'submitted', title: 'Add b' });
  });
  it('GET diff returns per-file diffs', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/workspaces/ws1/proposals/p1/diff' });
    expect(json(res).find((d: any) => d.path === 'b.md').status).toBe('added');
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
});
