import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/types.js';
import type { GoogleOAuth } from './google.js';
import { generateId } from '../util/id.js';
import { createState, readState, createSession, readSession } from './token.js';
import { serializeCookie, parseCookies } from './cookie.js';

export interface AuthDeps {
  db: Db;
  secret: string;
  appUrl: string;
  google: GoogleOAuth;
  /** Called once when a brand-new tenant is created, to seed its demo content. */
  seedTenant?: (tenantId: string) => Promise<void>;
}

const COOKIE = 'commons_session';
const STATE_COOKIE = 'commons_oauth_state';

/** Fastify preHandler: require a valid session; sets request.auth = { userId, tenantId }. */
export function makeRequireAuth(deps: AuthDeps) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    const userId = raw ? readSession(raw, deps.secret) : null;
    const user = userId ? deps.db.getUserById(userId) : undefined;
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    (req as FastifyRequest & { auth: { userId: string; tenantId: string } }).auth = {
      userId: user.id, tenantId: user.tenant_id,
    };
  };
}

/** Register the Google OAuth auth routes on `app`. */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const secure = deps.appUrl.startsWith('https');

  app.get('/api/auth/google/start', async (_req, reply) => {
    const state = createState(deps.secret);
    reply.header('set-cookie', serializeCookie(STATE_COOKIE, state, {
      httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 600,
    }));
    return reply.code(302).header('location', deps.google.authUrl(state)).send();
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const fail = () => reply.code(302).header('location', deps.appUrl + '/?error=auth').send();
    const { code, state } = req.query as { code?: string; state?: string };
    const cookieState = parseCookies(req.headers.cookie)[STATE_COOKIE];

    // CSRF: query state must match the cookie state and be a valid signed token.
    if (!code || !state || !cookieState || state !== cookieState || !readState(state, deps.secret)) {
      return fail();
    }

    const profile = await deps.google.exchangeCode(code);
    if (!profile || !profile.emailVerified) return fail();

    const email = profile.email.trim().toLowerCase();
    let user = deps.db.getUserByEmail(email);
    if (!user) {
      const tenantId = generateId('t');
      deps.db.createTenant(tenantId);
      user = deps.db.createUser(email, tenantId);
      // Seed demo content so the first screen is populated. A seed failure must
      // never block sign-in — log and continue with an empty workspace.
      if (deps.seedTenant) {
        try { await deps.seedTenant(tenantId); }
        catch (e) { req.log.error({ err: e, tenantId }, 'failed to seed onboarding workspace'); }
      }
    }

    const session = createSession(user.id, deps.secret);
    reply.header('set-cookie', [
      serializeCookie(COOKIE, session, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 3600 }),
      serializeCookie(STATE_COOKIE, '', { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 0 }),
    ]);
    return reply.code(302).header('location', deps.appUrl + '/').send();
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', serializeCookie(COOKIE, '', {
      httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 0,
    }));
    return reply.send({ ok: true });
  });

  // Unauthenticated-friendly probe: always 200 so the SPA's initial "am I
  // logged in?" check never surfaces a 401 in the browser console.
  app.get('/api/auth/session', async (req) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    const userId = raw ? readSession(raw, deps.secret) : null;
    const user = userId ? deps.db.getUserById(userId) : undefined;
    if (!user) return { authenticated: false as const };
    return { authenticated: true as const, userId: user.id, tenantId: user.tenant_id, email: user.email };
  });

  const requireAuth = makeRequireAuth(deps);
  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const { userId, tenantId } = (req as FastifyRequest & { auth: { userId: string; tenantId: string } }).auth;
    const user = deps.db.getUserById(userId)!;
    return { userId, tenantId, email: user.email };
  });
}
