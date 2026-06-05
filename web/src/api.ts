export interface Proposal { id: string; branch: string; title: string; status: string; createdAt: string; }
export interface FileDiff { path: string; status: 'added' | 'modified' | 'deleted'; diff: string; }
export type MergeResult = { merged: true } | { merged: false; conflicts: string[] };
export interface FileNode { path: string; type: 'file' | 'dir'; }

const j = async (r: Response) => { if (!r.ok) throw new Error(await r.text()); return r.json(); };

export const api = {
  workspaces: (): Promise<string[]> => fetch('/api/workspaces').then(j),
  proposals: (ws: string): Promise<Proposal[]> => fetch(`/api/workspaces/${ws}/proposals`).then(j),
  diff: (ws: string, id: string): Promise<FileDiff[]> => fetch(`/api/workspaces/${ws}/proposals/${id}/diff`).then(j),
  approve: (ws: string, id: string): Promise<MergeResult> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/approve`, { method: 'POST' }).then(j),
  reject: (ws: string, id: string): Promise<{ discarded: boolean }> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/reject`, { method: 'POST' }).then(j),
  state: (ws: string): Promise<FileNode[]> => fetch(`/api/workspaces/${ws}/state`).then(j),
  file: (ws: string, path: string): Promise<{ path: string; content: string }> =>
    fetch(`/api/workspaces/${ws}/file?path=${encodeURIComponent(path)}`).then(j),
  createWorkspace: (id: string, template: string): Promise<{ id: string }> =>
    fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, template }),
    }).then(j),
  getConfig: (ws: string): Promise<{ webhookUrl?: string }> =>
    fetch(`/api/workspaces/${ws}/config`).then(j),
  setConfig: (ws: string, webhookUrl: string): Promise<{ ok: boolean }> =>
    fetch(`/api/workspaces/${ws}/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webhookUrl }) }).then(j),
  published: (ws: string): Promise<Record<string, { publishedAt: string }>> =>
    fetch(`/api/workspaces/${ws}/published`).then(j),
  publish: (ws: string, path: string): Promise<{ published: boolean; publishedAt: string; title: string }> =>
    fetch(`/api/workspaces/${ws}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }).then(j),
};
