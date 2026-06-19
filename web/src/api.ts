export interface Proposal { id: string; branch: string; title: string; status: string; createdAt: string; }
export interface FileDiff { path: string; status: 'added' | 'modified' | 'deleted'; diff: string; }
export type MergeResult = { merged: true } | { merged: false; conflicts: string[] };
export interface FileNode { path: string; type: 'file' | 'dir'; }

export class UnauthorizedError extends Error {
  constructor() { super('unauthorized'); this.name = 'UnauthorizedError'; }
}

const j = async (r: Response) => {
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};

export const api = {
  auth: {
    // Initial probe — always 200, so an unauthenticated load doesn't log a
    // console error. Returns a discriminated union on `authenticated`.
    session: (): Promise<
      | { authenticated: false }
      | { authenticated: true; userId: string; tenantId: string; email: string }
    > => fetch('/api/auth/session').then(j),
    me: (): Promise<{ userId: string; tenantId: string; email: string }> =>
      fetch('/api/auth/me').then(j),
    request: (email: string): Promise<{ ok: boolean }> =>
      fetch('/api/auth/request', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
      }).then(j),
    logout: (): Promise<{ ok: boolean }> =>
      fetch('/api/auth/logout', { method: 'POST' }).then(j),
  },
  workspaces: (): Promise<string[]> => fetch('/api/workspaces').then(j),
  proposals: (ws: string): Promise<Proposal[]> => fetch(`/api/workspaces/${ws}/proposals`).then(j),
  diff: (ws: string, id: string): Promise<FileDiff[]> => fetch(`/api/workspaces/${ws}/proposals/${id}/diff`).then(j),
  proposalFile: (ws: string, id: string, path: string): Promise<{ path: string; content: string }> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/file?path=${encodeURIComponent(path)}`).then(j),
  approve: (ws: string, id: string): Promise<MergeResult> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/approve`, { method: 'POST' }).then(j),
  reject: (ws: string, id: string): Promise<{ discarded: boolean }> =>
    fetch(`/api/workspaces/${ws}/proposals/${id}/reject`, { method: 'POST' }).then(j),
  state: (ws: string): Promise<FileNode[]> => fetch(`/api/workspaces/${ws}/state`).then(j),
  file: (ws: string, path: string): Promise<{ path: string; content: string }> =>
    fetch(`/api/workspaces/${ws}/file?path=${encodeURIComponent(path)}`).then(j),
  deleteFile: (ws: string, path: string): Promise<{ deleted: boolean; path: string }> =>
    fetch(`/api/workspaces/${ws}/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' }).then(j),
  uploadFile: (ws: string, file: File): Promise<{ path: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`/api/workspaces/${ws}/files`, { method: 'POST', body: fd }).then(j);
  },
  createWorkspace: (id: string, template: string): Promise<{ id: string }> =>
    fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, template }),
    }).then(j),
  deleteWorkspace: (id: string): Promise<{ deleted: string }> =>
    fetch(`/api/workspaces/${id}`, { method: 'DELETE' }).then(j),
  agentStream: async (
    ws: string,
    prompt: string,
    onEvent: (e: { type: string; text?: string; name?: string; result?: string; message?: string }) => void,
    signal?: AbortSignal,
  ): Promise<void> => {
    const res = await fetch(`/api/workspaces/${ws}/agent`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }), signal,
    });
    if (!res.ok || !res.body) throw new Error(await res.text());
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
    }
  },
  getConfig: (ws: string): Promise<{ webhookUrl?: string }> =>
    fetch(`/api/workspaces/${ws}/config`).then(j),
  setConfig: (ws: string, webhookUrl: string): Promise<{ ok: boolean }> =>
    fetch(`/api/workspaces/${ws}/config`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ webhookUrl }) }).then(j),
  published: (ws: string): Promise<Record<string, { publishedAt: string }>> =>
    fetch(`/api/workspaces/${ws}/published`).then(j),
  publish: (ws: string, path: string): Promise<{ published: boolean; publishedAt: string; title: string }> =>
    fetch(`/api/workspaces/${ws}/publish`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) }).then(j),
  assetUrl: (ws: string, path: string): string =>
    `/api/workspaces/${ws}/asset?path=${encodeURIComponent(path)}`,
  proposalAssetUrl: (ws: string, id: string, path: string): string =>
    `/api/workspaces/${ws}/proposals/${id}/asset?path=${encodeURIComponent(path)}`,
};

export const isImage = (path: string): boolean =>
  /\.(png|jpe?g|webp|gif)$/i.test(path);

/**
 * Turn any thrown value into a human-readable Vietnamese message for the UI.
 * Handles: expired sessions, network failures (fetch throws TypeError), server
 * bodies that are JSON `{error|message}`, and HTML error pages (500 shells) —
 * which should never leak raw markup to the user.
 */
export function friendlyError(e: unknown): string {
  if (e instanceof UnauthorizedError) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  // fetch() rejects with a TypeError when the network is down / server unreachable.
  if (e instanceof TypeError) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
  const raw = (e instanceof Error ? e.message : String(e)).trim();
  if (!raw) return 'Đã xảy ra lỗi không xác định.';
  // server JSON error body
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed.error ?? parsed.message ?? 'Đã xảy ra lỗi.';
  } catch { /* not JSON */ }
  // an HTML error page (e.g. a proxy 500/502) — don't dump markup at the user
  if (/^\s*<(!doctype|html)/i.test(raw)) return 'Máy chủ gặp sự cố. Vui lòng thử lại sau.';
  return raw;
}
