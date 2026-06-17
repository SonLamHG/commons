import type { FastifyInstance } from 'fastify';

// CSP tuned for this SPA: self-hosted JS/CSS, Google Fonts stylesheet + font files,
// data: images (the app embeds generated images as data URLs in places), same-origin XHR/NDJSON.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

/** Apply security response headers to every route. */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('x-permitted-cross-domain-policies', 'none');
    reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
  });
}
