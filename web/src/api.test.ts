import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, UnauthorizedError } from './api';

afterEach(() => { vi.restoreAllMocks(); });

describe('api.auth', () => {
  it('me() GETs /api/auth/me and returns the session', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ userId: 'u', tenantId: 't', email: 'a@x.com' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await api.auth.me()).toEqual({ userId: 'u', tenantId: 't', email: 'a@x.com' });
    expect(f.mock.calls[0][0]).toBe('/api/auth/me');
  });

  it('throws UnauthorizedError on HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(api.auth.me()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('logout() POSTs /api/auth/logout', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await api.auth.logout();
    expect(f.mock.calls[0][0]).toBe('/api/auth/logout');
    expect((f.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });
});
