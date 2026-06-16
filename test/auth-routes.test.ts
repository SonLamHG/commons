import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb } from '../src/db/index.js';
import { registerAuthRoutes } from '../src/auth/routes.js';
import type { Mailer } from '../src/auth/mailer.js';

const SECRET = 'test-secret';
const APP_URL = 'http://localhost:8787';

let app: FastifyInstance;
let db: ReturnType<typeof createDb>;
let sent: { to: string; subject: string; text: string }[];

beforeEach(async () => {
  db = createDb(':memory:');
  sent = [];
  const mailer: Mailer = { async send(to, subject, text) { sent.push({ to, subject, text }); } };
  app = Fastify();
  registerAuthRoutes(app, { db, secret: SECRET, appUrl: APP_URL, mailer });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const callbackPath = () => sent[0].text.match(/(\/api\/auth\/callback\?token=[^\s]+)/)![1];
const cookieFrom = (res: { headers: Record<string, unknown> }) => {
  const sc = res.headers['set-cookie'];
  const raw = Array.isArray(sc) ? sc[0] : (sc as string);
  return raw.split(';')[0]; // "commons_session=..."
};

describe('auth routes', () => {
  it('completes the magic-link flow for an invited email', async () => {
    db.addInvite('alice@example.com');

    const req = await app.inject({ method: 'POST', url: '/api/auth/request', payload: { email: 'Alice@Example.com' } });
    expect(req.statusCode).toBe(200);
    expect(sent.length).toBe(1);

    const cb = await app.inject({ method: 'GET', url: callbackPath() });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(APP_URL + '/');

    const user = db.getUserByEmail('alice@example.com');
    expect(user).toBeDefined();
    expect(db.getTenant(user!.tenant_id)).toBeDefined();

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieFrom(cb) } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'alice@example.com', tenantId: user!.tenant_id });
  });

  it('does not send mail for a non-invited email but still returns 200', async () => {
    const req = await app.inject({ method: 'POST', url: '/api/auth/request', payload: { email: 'stranger@example.com' } });
    expect(req.statusCode).toBe(200);
    expect(sent.length).toBe(0);
  });

  it('rejects an invalid callback token', async () => {
    const cb = await app.inject({ method: 'GET', url: '/api/auth/callback?token=garbage' });
    expect(cb.statusCode).toBe(401);
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
