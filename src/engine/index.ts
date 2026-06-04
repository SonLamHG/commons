import { simpleGit, type SimpleGit } from 'simple-git';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep, isAbsolute } from 'node:path';
import type { Engine, Proposal, FileDiff } from './types.js';

export function createEngine(rootDir: string): Engine {
  const repoPath = (ws: string) => join(rootDir, 'repos', ws);
  const worktreePath = (ws: string, p: string) => join(rootDir, 'worktrees', ws, p);
  const metaPath = (ws: string) => join(rootDir, 'meta', ws, 'proposals.json');

  function readMeta(ws: string): Proposal[] {
    const m = metaPath(ws);
    return existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')) : [];
  }
  function writeMeta(ws: string, list: Proposal[]) {
    const m = metaPath(ws);
    mkdirSync(dirname(m), { recursive: true });
    writeFileSync(m, JSON.stringify(list, null, 2));
  }
  function updateProposal(ws: string, id: string, patch: Partial<Proposal>) {
    const list = readMeta(ws);
    const i = list.findIndex((p) => p.id === id);
    if (i === -1) throw new Error(`proposal ${id} not found`);
    list[i] = { ...list[i], ...patch };
    writeMeta(ws, list);
  }

  function safeJoin(base: string, rel: string): string {
    const abs = join(base, rel);
    const r = relative(base, abs);
    if (r.startsWith('..') || isAbsolute(r)) {
      throw new Error(`unsafe path: ${rel}`);
    }
    return abs;
  }

  function listFiles(dir: string, base: string, out: { path: string; type: 'file' | 'dir' }[]) {
    for (const entry of readdirSync(dir)) {
      if (entry === '.git') continue;
      const abs = join(dir, entry);
      const rel = relative(base, abs).split(sep).join('/');
      if (statSync(abs).isDirectory()) {
        out.push({ path: rel, type: 'dir' });
        listFiles(abs, base, out);
      } else {
        out.push({ path: rel, type: 'file' });
      }
    }
  }

  return {
    async createWorkspace({ id, seed }) {
      const path = repoPath(id);
      if (existsSync(join(path, '.git'))) {
        throw new Error(`workspace already exists: ${id}`);
      }
      mkdirSync(path, { recursive: true });
      const git: SimpleGit = simpleGit(path);
      await git.init();
      await git.addConfig('user.email', 'engine@commons.local');
      await git.addConfig('user.name', 'Commons Engine');
      // ensure branch is named 'main' regardless of git's init.defaultBranch config
      await git.raw(['checkout', '-B', 'main']);
      for (const [rel, content] of Object.entries(seed ?? {})) {
        const abs = safeJoin(path, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
      await git.add('.');
      await git.commit('init workspace');
    },

    async readState(workspaceId) {
      const out: { path: string; type: 'file' | 'dir' }[] = [];
      listFiles(repoPath(workspaceId), repoPath(workspaceId), out);
      return out;
    },

    async readFile(workspaceId, path) {
      return readFileSync(join(repoPath(workspaceId), path), 'utf8');
    },

    async createProposal(workspaceId, { id, title }) {
      const git = simpleGit(repoPath(workspaceId));
      const existing = readMeta(workspaceId);
      if (existing.find((p) => p.id === id)) {
        throw new Error(`proposal already exists: ${id}`);
      }
      const wt = worktreePath(workspaceId, id);
      mkdirSync(dirname(wt), { recursive: true });
      await git.raw(['worktree', 'add', wt, '-b', `proposal/${id}`]);
      existing.push({
        id,
        branch: `proposal/${id}`,
        title,
        status: 'open',
        createdAt: new Date().toISOString(),
      });
      writeMeta(workspaceId, existing);
    },
    async writeProposalFile(workspaceId, proposalId, path, content) {
      const wt = worktreePath(workspaceId, proposalId);
      const abs = safeJoin(wt, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    },
    async submitProposal(workspaceId, proposalId, message) {
      const wt = worktreePath(workspaceId, proposalId);
      const git = simpleGit(wt);
      await git.add('.');
      await git.commit(message);
      updateProposal(workspaceId, proposalId, { status: 'submitted' });
    },
    async diffProposal(workspaceId, proposalId) {
      const git = simpleGit(repoPath(workspaceId));
      const branch = `proposal/${proposalId}`;
      const nameStatus = await git.raw(['diff', '--name-status', 'main', branch]);
      const result: FileDiff[] = [];
      for (const line of nameStatus.split('\n').filter(Boolean)) {
        const [code, path] = line.split('\t');
        const status = code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified';
        const patch = await git.raw(['diff', 'main', branch, '--', path]);
        result.push({ path, status, diff: patch });
      }
      return result;
    },
    async mergeProposal(workspaceId, proposalId) {
      const repo = repoPath(workspaceId);
      const git = simpleGit(repo);
      const branch = `proposal/${proposalId}`;
      await git.raw(['checkout', 'main']);

      let mergeError: unknown;
      try {
        await git.raw(['merge', '--no-ff', '-m', `merge ${branch}`, branch]);
      } catch (e) {
        // Some git/simple-git versions reject on conflict; disambiguate via git state below.
        mergeError = e;
      }

      // Locale-independent conflict detection: inspect unmerged entries, not stdout text.
      const conflicted = (await git.raw(['diff', '--name-only', '--diff-filter=U']))
        .split('\n')
        .filter(Boolean);
      if (conflicted.length > 0) {
        await git.raw(['merge', '--abort']);
        return { merged: false, conflicts: conflicted };
      }

      // Merge threw but produced no conflicted files => a real error (e.g. unknown branch). Surface it.
      if (mergeError) throw mergeError;

      const wt = worktreePath(workspaceId, proposalId);
      await git.raw(['worktree', 'remove', wt, '--force']);
      await git.raw(['branch', '-D', branch]);
      updateProposal(workspaceId, proposalId, { status: 'merged' });
      return { merged: true };
    },
    async discardProposal() { throw new Error('not implemented'); },
    async listProposals(workspaceId) {
      return readMeta(workspaceId);
    },
  };
}
