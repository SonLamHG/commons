import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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

describe('proposal lifecycle', () => {
  it('creates a proposal as an isolated worktree and lists it', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'Draft posts' });

    const proposals = await engine.listProposals('ws1');
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      id: 'p1',
      branch: 'proposal/p1',
      title: 'Draft posts',
      status: 'open',
    });
    expect(existsSync(join(root, 'worktrees', 'ws1', 'p1'))).toBe(true);
  });

  it('rejects duplicate proposal ids', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'first' });
    await expect(
      engine.createProposal('ws1', { id: 'p1', title: 'dup' }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('proposal writes', () => {
  it('writes files into the proposal worktree and commits on submit', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'Add post' });
    await engine.writeProposalFile('ws1', 'p1', 'posts/post-1.md', '# Post 1');
    await engine.submitProposal('ws1', 'p1', 'add post 1');

    // main không bị ảnh hưởng (isolation)
    const mainState = await engine.readState('ws1');
    expect(mainState.find((n) => n.path === 'posts/post-1.md')).toBeUndefined();

    const proposals = await engine.listProposals('ws1');
    expect(proposals[0].status).toBe('submitted');
  });

  it('rejects proposal file paths that escape the worktree', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'x' });
    await expect(
      engine.writeProposalFile('ws1', 'p1', '../../escape.md', 'nope'),
    ).rejects.toThrow(/unsafe path/);
  });
});

describe('diff', () => {
  it('returns per-file diffs of a proposal against main', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'Edit + add' });
    await engine.writeProposalFile('ws1', 'p1', 'a.md', 'hello world');     // modified
    await engine.writeProposalFile('ws1', 'p1', 'b.md', 'new file');        // added
    await engine.submitProposal('ws1', 'p1', 'edit a, add b');

    const diffs = await engine.diffProposal('ws1', 'p1');
    const byPath = Object.fromEntries(diffs.map((d) => [d.path, d.status]));
    expect(byPath['a.md']).toBe('modified');
    expect(byPath['b.md']).toBe('added');
    expect(diffs.find((d) => d.path === 'b.md')!.diff).toContain('new file');
  });
});

describe('merge', () => {
  it('merges a clean proposal into main and removes the worktree', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'Add b' });
    await engine.writeProposalFile('ws1', 'p1', 'b.md', 'bee');
    await engine.submitProposal('ws1', 'p1', 'add b');

    const res = await engine.mergeProposal('ws1', 'p1');
    expect(res).toEqual({ merged: true });

    const state = await engine.readState('ws1');
    expect(state.find((n) => n.path === 'b.md')).toBeDefined();
    expect((await engine.listProposals('ws1'))[0].status).toBe('merged');
  });

  it('detects conflicts and does not corrupt main', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'base' } });

    await engine.createProposal('ws1', { id: 'p1', title: 'p1' });
    await engine.writeProposalFile('ws1', 'p1', 'a.md', 'from p1');
    await engine.submitProposal('ws1', 'p1', 'p1 edits a');

    await engine.createProposal('ws1', { id: 'p2', title: 'p2' });
    await engine.writeProposalFile('ws1', 'p2', 'a.md', 'from p2');
    await engine.submitProposal('ws1', 'p2', 'p2 edits a');

    expect(await engine.mergeProposal('ws1', 'p1')).toEqual({ merged: true });

    const res = await engine.mergeProposal('ws1', 'p2');
    expect(res.merged).toBe(false);
    if (!res.merged) expect(res.conflicts).toContain('a.md');

    expect(await engine.readFile('ws1', 'a.md')).toBe('from p1');
  });

  it('throws (not a false conflict) when merging a non-existent proposal', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await expect(engine.mergeProposal('ws1', 'ghost')).rejects.toThrow();
  });
});
