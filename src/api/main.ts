import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { createEngineRegistry } from '../engine/registry.js';
import { WorkspaceSerializer } from '../util/serializer.js';
import { buildApi } from './server.js';
import { createDb } from '../db/index.js';
import { createClaudeRunner } from '../agent/runner.js';
import { mailerFromEnv } from '../auth/mailer.js';
import { loadEnv } from '../util/env.js';

loadEnv(); // pick up secrets/env from a project-root .env before reading process.env

const root = resolve(process.env.COMMONS_ROOT ?? join(process.cwd(), 'data'));
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const appUrl = process.env.COMMONS_APP_URL ?? `http://localhost:${port}`;

const authSecret = process.env.COMMONS_AUTH_SECRET;
if (!authSecret) {
  process.stderr.write('COMMONS_AUTH_SECRET is required (set it in .env) — refusing to start.\n');
  process.exit(1);
}

const db = createDb(join(root, 'commons.db'));

// Beta allowlist: seed invited emails from COMMONS_INVITES (comma-separated).
for (const email of (process.env.COMMONS_INVITES ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  db.addInvite(email);
}

const app = buildApi({
  registry: createEngineRegistry(root),
  serializer: new WorkspaceSerializer(),
  db,
  authSecret,
  appUrl,
  mailer: mailerFromEnv(),
  agentRunner: createClaudeRunner(),
});

const dist = join(process.cwd(), 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    // Unknown API routes must return JSON 404, NOT the SPA shell (which breaks the client's JSON parse).
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found', path: req.url });
    return reply.sendFile('index.html'); // SPA fallback for app routes only
  });
}

app.listen({ port, host })
  .then(() => process.stdout.write(`commons review UI on http://localhost:${port}\n`))
  .catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      process.stderr.write(`port ${port} is already in use — is another api process still running?\n`);
    } else {
      process.stderr.write(String(e) + '\n');
    }
    process.exit(1);
  });

// Graceful shutdown: release the listening socket on every signal.
let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  process.stderr.write(`\n${signal} received — closing server…\n`);
  try {
    await app.close();
    process.exit(0);
  } catch (e) {
    process.stderr.write(String(e) + '\n');
    process.exit(1);
  }
}
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => void shutdown(sig));
}
