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
