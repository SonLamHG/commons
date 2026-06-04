import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/engine/index.js';
import type { Engine } from '../src/engine/types.js';

let root: string;
let engine: Engine;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'commons-'));
  engine = createEngine(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('workspace', () => {
  it('creates a workspace with seed files and reads state', async () => {
    await engine.createWorkspace({
      id: 'ws1',
      seed: { 'brand-voice.md': '# Voice\nFriendly', 'config/channels.yaml': 'channels: [blog]' },
    });

    const state = await engine.readState('ws1');
    const paths = state.filter((n) => n.type === 'file').map((n) => n.path).sort();
    expect(paths).toEqual(['brand-voice.md', 'config/channels.yaml']);

    const content = await engine.readFile('ws1', 'brand-voice.md');
    expect(content).toBe('# Voice\nFriendly');

    expect(state.some((n) => n.path === 'config' && n.type === 'dir')).toBe(true);
  });

  it('rejects seed paths that escape the workspace', async () => {
    await expect(
      engine.createWorkspace({ id: 'evil', seed: { '../escape.md': 'x' } }),
    ).rejects.toThrow(/unsafe path/);
  });
});
