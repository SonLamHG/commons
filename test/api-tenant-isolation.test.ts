import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngineRegistry } from '../src/engine/registry.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { buildApi } from '../src/api/server.js';
import { createDb } from '../src/db/index.js';
import { createSession } from '../src/auth/token.js';
import type { GoogleOAuth } from '../src/auth/google.js';

const SECRET = 'test-secret';
const noopGoogle: GoogleOAuth = { authUrl: () => 'https://accounts.google.com', async exchangeCode() { return null; } };
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
  app = buildApi({ registry, serializer: new WorkspaceSerializer(), db, authSecret: SECRET, appUrl: 'http://localhost:8787', google: noopGoogle });

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
