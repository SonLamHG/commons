export interface Proposal { id: string; branch: string; title: string; status: string; createdAt: string; }
export interface FileDiff { path: string; status: 'added' | 'modified' | 'deleted'; diff: string; }
export type MergeResult = { merged: true } | { merged: false; conflicts: string[] };

const j = async (r: Response) => { if (!r.ok) throw new Error(await r.text()); return r.json(); };

export const api = {
  workspaces: (): Promise<string[]> => fetch('/api/workspaces').then(j),
  proposals: (ws: string): Promise<Proposal[]> => fetch(`/api/workspaces/${ws}/proposals`).then(j),
  diff: (ws: string, id: string): Promise<FileDiff[]> => fetch(`/api/workspaces/${ws}/proposals/${id}/diff`).then(j),
  approve: (ws: string, id: string): Promise<MergeResult> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/approve`, { method: 'POST' }).then(j),
  reject: (ws: string, id: string): Promise<{ discarded: boolean }> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/reject`, { method: 'POST' }).then(j),
};
