import { simpleGit, type SimpleGit } from 'simple-git';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep, isAbsolute } from 'node:path';
import type { Engine } from './types.js';

export function createEngine(rootDir: string): Engine {
  const repoPath = (ws: string) => join(rootDir, 'repos', ws);

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

    async createProposal() { throw new Error('not implemented'); },
    async writeProposalFile() { throw new Error('not implemented'); },
    async submitProposal() { throw new Error('not implemented'); },
    async diffProposal() { throw new Error('not implemented'); },
    async mergeProposal() { throw new Error('not implemented'); },
    async discardProposal() { throw new Error('not implemented'); },
    async listProposals() { throw new Error('not implemented'); },
  };
}
