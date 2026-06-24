import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb } from '../src/db/index.js';
import { registerAuthRoutes } from '../src/auth/routes.js';
import type { GoogleOAuth, GoogleProfile } from '../src/auth/google.js';

const SECRET = 'test-secret';
const APP_URL = 'http://localhost:8787';

let app: FastifyInstance;
let db: ReturnType<typeof createDb>;
let profile: GoogleProfile | null;

const fakeGoogle: GoogleOAuth = {
  authUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  async exchangeCode() { return profile; },
};

beforeEach(async () => {
  db = createDb(':memory:');
  profile = { email: 'alice@example.com', emailVerified: true };
  app = Fastify();
  registerAuthRoutes(app, { db, secret: SECRET, appUrl: APP_URL, google: fakeGoogle });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const cookieVal = (res: { headers: Record<string, unknown> }, name: string) => {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc as string];
  const raw = arr.find((c) => c.startsWith(name + '='))!;
  return raw.split(';')[0]; // "name=value"
};

describe('google auth routes', () => {
  it('start redirects to Google and sets a state cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    expect(cookieVal(res, 'commons_oauth_state')).toContain('commons_oauth_state=');
  });

  it('completes the callback for a verified email', async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    const stateCookie = cookieVal(start, 'commons_oauth_state');
    const state = decodeURIComponent(stateCookie.split('=')[1]);

    const cb = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(APP_URL + '/');

    const user = db.getUserByEmail('alice@example.com');
    expect(user).toBeDefined();
    expect(db.getTenant(user!.tenant_id)).toBeDefined();

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieVal(cb, 'commons_session') } });
    expect(me.json()).toMatchObject({ email: 'alice@example.com' });
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    const stateCookie = cookieVal(start, 'commons_oauth_state');
    const cb = await app.inject({
      method: 'GET', url: '/api/auth/google/callback?code=abc&state=wrong',
      headers: { cookie: stateCookie },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(APP_URL + '/?error=auth');
    expect(db.getUserByEmail('alice@example.com')).toBeUndefined();
  });

  it('rejects an unverified email', async () => {
    profile = { email: 'bob@example.com', emailVerified: false };
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    const stateCookie = cookieVal(start, 'commons_oauth_state');
    const state = decodeURIComponent(stateCookie.split('=')[1]);
    const cb = await app.inject({
      method: 'GET', url: `/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    });
    expect(cb.headers.location).toBe(APP_URL + '/?error=auth');
    expect(db.getUserByEmail('bob@example.com')).toBeUndefined();
  });

  it('rejects /me without a session', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(me.statusCode).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(out.statusCode).toBe(200);
    const sc = out.headers['set-cookie'];
    const raw = Array.isArray(sc) ? sc[0] : (sc as string);
    expect(raw).toContain('Max-Age=0');
  });
});
