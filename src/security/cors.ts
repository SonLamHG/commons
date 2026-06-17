import type { FastifyInstance } from 'fastify';

/** Same-origin SPA: only reflect the configured app origin, and answer preflight.
 * Credentials are allowed so the session cookie flows on cross-origin XHR if ever needed. */
export function registerCors(app: FastifyInstance, allowedOrigin: string): void {
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin === allowedOrigin) {
      reply.header('access-control-allow-origin', allowedOrigin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      reply.header('access-control-allow-headers', 'content-type');
    }
    if (req.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });
}
