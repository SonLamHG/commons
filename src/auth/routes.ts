import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/types.js';
import type { Mailer } from './mailer.js';
import { generateId } from '../util/id.js';
import { createMagicToken, readMagicToken, createSession, readSession } from './token.js';
import { serializeCookie, parseCookies } from './cookie.js';

export interface AuthDeps {
  db: Db;
  secret: string;
  appUrl: string;
  mailer: Mailer;
  /** When true, any valid email may sign in — the invite allowlist is bypassed. */
  openSignup?: boolean;
}

const COOKIE = 'commons_session';

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

/** Register the magic-link auth routes on `app`. */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const secure = deps.appUrl.startsWith('https');
  // Allow sign-in when open signup is on, otherwise require an invite.
  const allowed = (email: string) => deps.openSignup === true || deps.db.isInvited(email);

  app.post('/api/auth/request', async (req, reply) => {
    const { email } = (req.body ?? {}) as { email?: string };
    if (!email || !email.includes('@')) return reply.code(400).send({ error: 'valid email required' });
    if (allowed(email)) {
      const token = createMagicToken(email, deps.secret);
      const link = `${deps.appUrl}/api/auth/callback?token=${encodeURIComponent(token)}`;
      await deps.mailer.send(
        email,
        'Your Commons sign-in link',
        `Sign in to Commons:\n${link}\n\nThis link expires in 15 minutes.`,
      );
    }
    return reply.send({ ok: true }); // generic — never leak invite status
  });

  app.get('/api/auth/callback', async (req, reply) => {
    const { token } = req.query as { token?: string };
    const email = token ? readMagicToken(token, deps.secret) : null;
    if (!email || !allowed(email)) return reply.code(401).send({ error: 'invalid or expired link' });

    let user = deps.db.getUserByEmail(email);
    if (!user) {
      const tenantId = generateId('t');
      deps.db.createTenant(tenantId);
      user = deps.db.createUser(email, tenantId);
    }
    deps.db.markInviteAccepted(email);

    const session = createSession(user.id, deps.secret);
    reply.header('set-cookie', serializeCookie(COOKIE, session, {
      httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 3600,
    }));
    return reply.code(302).header('location', deps.appUrl + '/').send();
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', serializeCookie(COOKIE, '', {
      httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 0,
    }));
    return reply.send({ ok: true });
  });

  // Unauthenticated-friendly probe: always 200 so the SPA's initial "am I
  // logged in?" check never surfaces a 401 in the browser console (the browser
  // logs every 4xx fetch regardless of how JS handles it).
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
