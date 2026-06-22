import { describe, it, expect, vi, afterEach } from 'vitest';
import { consoleMailer, resendMailer } from '../src/auth/mailer.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('auth/mailer', () => {
  it('console mailer does not throw', async () => {
    await expect(consoleMailer().send('a@x.com', 'subj', 'body')).resolves.toBeUndefined();
  });

  it('resend mailer POSTs the expected payload', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await resendMailer('key-123', 'noreply@commons.app').send('a@x.com', 'Hi', 'Body');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key-123');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'noreply@commons.app', to: 'a@x.com', subject: 'Hi', text: 'Body',
    });
  });

  it('resend mailer throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 422 })));
    await expect(resendMailer('k', 'f@x.com').send('a@x.com', 's', 'b')).rejects.toThrow(/resend failed: 422/);
  });
});
