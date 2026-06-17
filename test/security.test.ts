import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerSecurityHeaders } from '../src/security/headers.js';
import { registerCors } from '../src/security/cors.js';
import { createRateLimiter, registerRateLimit } from '../src/security/rateLimit.js';

describe('security headers', () => {
  it('sets hardening headers and a CSP that allows Google Fonts', async () => {
    const app = Fastify();
    registerSecurityHeaders(app);
    app.get('/x', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('fonts.googleapis.com');
    expect(csp).toContain('fonts.gstatic.com');
    await app.close();
  });
});

describe('cors', () => {
  const build = () => {
    const app = Fastify();
    registerCors(app, 'https://app.example');
    app.get('/x', async () => ({ ok: true }));
    return app;
  };

  it('reflects the allowed origin and allows credentials', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/x', headers: { origin: 'https://app.example' } });
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    await app.close();
  });

  it('does not reflect a foreign origin', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/x', headers: { origin: 'https://evil.example' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('answers preflight with 204', async () => {
    const app = build();
    const res = await app.inject({ method: 'OPTIONS', url: '/x', headers: { origin: 'https://app.example' } });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example');
    await app.close();
  });

  it('does not intercept OPTIONS without a matching origin', async () => {
    const app = build();
    const res = await app.inject({ method: 'OPTIONS', url: '/x' }); // no Origin header
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    // should fall through — Fastify returns 200 (GET handler exists) or 404; not 204
    expect(res.statusCode).not.toBe(204);
    await app.close();
  });
});

describe('rate limiter (pure)', () => {
  it('allows up to max within the window, then blocks', () => {
    const rl = createRateLimiter();
    const limit = { max: 2, windowMs: 1000 };
    expect(rl.check('k', limit, 0)).toBe(true);
    expect(rl.check('k', limit, 10)).toBe(true);
    expect(rl.check('k', limit, 20)).toBe(false);     // over max
    expect(rl.check('k', limit, 1001)).toBe(true);    // window rolled over
  });
});

describe('rate limit hook', () => {
  it('returns 429 after the limit is exceeded', async () => {
    const app = Fastify();
    registerRateLimit(app, { global: { max: 2, windowMs: 60000 }, auth: { max: 2, windowMs: 60000 } });
    app.get('/x', async () => ({ ok: true }));
    const hit = () => app.inject({ method: 'GET', url: '/x', headers: { 'x-forwarded-for': '5.5.5.5' } });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const blocked = await hit();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    await app.close();
  });
});
