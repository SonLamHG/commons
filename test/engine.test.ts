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

  it('reads the proposed (final) version of a file from the worktree', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'x' });
    await engine.writeProposalFile('ws1', 'p1', 'a.md', 'hello world');
    // proposal sees the new content; main is untouched
    expect(await engine.readProposalFile('ws1', 'p1', 'a.md')).toBe('hello world');
    expect(await engine.readFile('ws1', 'a.md')).toBe('hello');
  });

  it('rejects readProposalFile paths that escape the worktree', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'x' });
    await expect(engine.readProposalFile('ws1', 'p1', '../../escape.md')).rejects.toThrow(/unsafe path/);
  });
});

describe('addFile (human-provided source material)', () => {
  it('writes a file straight to main and commits it', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.addFile('ws1', 'reference/brief.md', '# Brief\n\nLaunch in June.');
    expect(await engine.readFile('ws1', 'reference/brief.md')).toBe('# Brief\n\nLaunch in June.');
    const state = await engine.readState('ws1');
    expect(state.find((n) => n.path === 'reference/brief.md' && n.type === 'file')).toBeTruthy();
  });

  it('a proposal created after an upload can read the uploaded material', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.addFile('ws1', 'reference/brief.md', 'launch June');
    await engine.createProposal('ws1', { id: 'p1', title: 'x' });
    expect(await engine.readProposalFile('ws1', 'p1', 'reference/brief.md')).toBe('launch June');
  });

  it('rejects addFile paths that escape the workspace', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await expect(engine.addFile('ws1', '../../escape.md', 'nope')).rejects.toThrow(/unsafe path/);
  });
});

describe('deleteFile', () => {
  it('removes a file from main and commits', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello', 'reference/brief.md': 'x' } });
    await engine.deleteFile('ws1', 'reference/brief.md');
    const state = await engine.readState('ws1');
    expect(state.find((n) => n.path === 'reference/brief.md')).toBeUndefined();
    expect(state.find((n) => n.path === 'a.md')).toBeTruthy();
  });

  it('throws a clean error when the file does not exist', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await expect(engine.deleteFile('ws1', 'nope.md')).rejects.toThrow(/file not found/);
  });

  it('rejects deleteFile paths that escape the workspace', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await expect(engine.deleteFile('ws1', '../../escape.md')).rejects.toThrow(/unsafe path/);
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
    expect(existsSync(join(root, 'worktrees', 'ws1', 'p1'))).toBe(false);
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

    const p2 = (await engine.listProposals('ws1')).find((p) => p.id === 'p2');
    expect(p2!.status).toBe('submitted');
  });

  it('throws (not a false conflict) when merging a non-existent proposal', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await expect(engine.mergeProposal('ws1', 'ghost')).rejects.toThrow();
  });

  it('composes two clean non-conflicting merges into main', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'base' } });

    await engine.createProposal('ws1', { id: 'p1', title: 'add b' });
    await engine.writeProposalFile('ws1', 'p1', 'b.md', 'bee');
    await engine.submitProposal('ws1', 'p1', 'add b');

    await engine.createProposal('ws1', { id: 'p2', title: 'add c' });
    await engine.writeProposalFile('ws1', 'p2', 'c.md', 'see');
    await engine.submitProposal('ws1', 'p2', 'add c');

    expect(await engine.mergeProposal('ws1', 'p1')).toEqual({ merged: true });
    expect(await engine.mergeProposal('ws1', 'p2')).toEqual({ merged: true });

    const state = await engine.readState('ws1');
    expect(state.find((n) => n.path === 'b.md')).toBeDefined();
    expect(state.find((n) => n.path === 'c.md')).toBeDefined();
  });
});

describe('guards', () => {
  it('rejects invalid workspace and proposal ids', async () => {
    await expect(engine.createWorkspace({ id: '../evil', seed: {} })).rejects.toThrow(/invalid workspace id/);
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hi' } });
    await expect(engine.createProposal('ws1', { id: 'bad/id', title: 'x' })).rejects.toThrow(/invalid proposal id/);
  });

  it('rejects readFile paths that escape the workspace', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hi' } });
    await expect(engine.readFile('ws1', '../../escape.md')).rejects.toThrow(/unsafe path/);
  });

  it('rejects writing to a merged proposal', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hi' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'x' });
    await engine.writeProposalFile('ws1', 'p1', 'b.md', 'bee');
    await engine.submitProposal('ws1', 'p1', 'add b');
    await engine.mergeProposal('ws1', 'p1');
    await expect(engine.writeProposalFile('ws1', 'p1', 'c.md', 'no')).rejects.toThrow(/merged/);
  });
});

describe('discard', () => {
  it('discards a proposal: removes worktree, deletes branch, marks discarded', async () => {
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
    await engine.createProposal('ws1', { id: 'p1', title: 'junk' });
    await engine.writeProposalFile('ws1', 'p1', 'junk.md', 'nope');
    await engine.submitProposal('ws1', 'p1', 'junk');

    await engine.discardProposal('ws1', 'p1');

    expect((await engine.listProposals('ws1'))[0].status).toBe('discarded');
    const state = await engine.readState('ws1');
    expect(state.find((n) => n.path === 'junk.md')).toBeUndefined();
    // worktree dir removed
    expect(existsSync(join(root, 'worktrees', 'ws1', 'p1'))).toBe(false);
    // merging after discard must reject (mergeProposal guard: status !== 'submitted')
    await expect(engine.mergeProposal('ws1', 'p1')).rejects.toThrow();
  });
});

describe('listWorkspaces', () => {
  it('lists created workspaces and ignores non-workspace dirs', async () => {
    expect(await engine.listWorkspaces()).toEqual([]);
    await engine.createWorkspace({ id: 'alpha', seed: { 'a.md': '1' } });
    await engine.createWorkspace({ id: 'beta', seed: { 'b.md': '2' } });
    expect((await engine.listWorkspaces()).sort()).toEqual(['alpha', 'beta']);
  });
});
