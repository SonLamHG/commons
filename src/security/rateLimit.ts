import type { FastifyInstance } from 'fastify';

export interface RateLimit { max: number; windowMs: number; }
interface Bucket { count: number; resetAt: number; }

/** In-memory fixed-window limiter. Single-node only (matches ADR-1's single-writer node). */
export function createRateLimiter() {
  const buckets = new Map<string, Bucket>();
  return {
    /** Returns true if allowed; false if the bucket is exhausted. */
    check(key: string, limit: RateLimit, now: number = Date.now()): boolean {
      const b = buckets.get(key);
      if (!b || now >= b.resetAt) { buckets.set(key, { count: 1, resetAt: now + limit.windowMs }); return true; }
      if (b.count >= limit.max) return false;
      b.count++;
      return true;
    },
    /** retryAfter seconds for a key, for the Retry-After header. */
    retryAfter(key: string, now: number = Date.now()): number {
      const b = buckets.get(key);
      return b ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : 1;
    },
  };
}

export interface RateLimitOpts { global: RateLimit; auth: RateLimit; }

const DEFAULTS: RateLimitOpts = {
  global: { max: 300, windowMs: 60_000 },  // 300 req/min/IP overall
  auth:   { max: 30,  windowMs: 60_000 },  // 30 sign-in requests/min/IP
};

/** Install an onRequest rate-limit hook. Auth endpoints get a stricter bucket. */
export function registerRateLimit(app: FastifyInstance, opts: RateLimitOpts = DEFAULTS): void {
  const rl = createRateLimiter();
  app.addHook('onRequest', async (req, reply) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    // The session probe is a cheap, read-only cookie check the SPA fires on every
    // page load — keep it in the general bucket. Only the interactive sign-in
    // endpoints (google/start, google/callback, logout) get the stricter bucket.
    const isAuth = req.url.startsWith('/api/auth/') && !req.url.startsWith('/api/auth/session');
    const limit = isAuth ? opts.auth : opts.global;
    const key = `${isAuth ? 'auth' : 'global'}:${ip}`;
    if (!rl.check(key, limit, now)) {
      reply.header('retry-after', String(rl.retryAfter(key, now)));
      return reply.code(429).send({ error: 'rate limit exceeded — slow down' });
    }
  });
}
