import { join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { createEngine } from '../engine/index.js';
import { WorkspaceSerializer } from '../util/serializer.js';
import { buildApi } from './server.js';
import { createPublishStore } from '../publish/store.js';
import { createClaudeRunner } from '../agent/runner.js';
import { loadEnv } from '../util/env.js';

loadEnv(); // pick up GEMINI_API_KEY etc. from a project-root .env before anything reads process.env

const root = process.env.COMMONS_ROOT ?? join(process.cwd(), 'data');
const port = Number(process.env.PORT ?? 8787);

const publishStore = createPublishStore(root);
const app = buildApi(createEngine(root), new WorkspaceSerializer(), publishStore, createClaudeRunner(root));

const dist = join(process.cwd(), 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => {
    // Unknown API routes must return JSON 404, NOT the SPA shell (which breaks the client's JSON parse).
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found', path: req.url });
    return reply.sendFile('index.html'); // SPA fallback for app routes only
  });
}

app.listen({ port, host: '0.0.0.0' })
  .then(() => process.stdout.write(`commons review UI on http://localhost:${port}\n`))
  .catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRINUSE') {
      process.stderr.write(`port ${port} is already in use — is another api process still running?\n`);
    } else {
      process.stderr.write(String(e) + '\n');
    }
    process.exit(1);
  });

// Graceful shutdown: release the listening socket on every signal so the
// process exits cleanly instead of lingering and holding the port (which is
// what turns a Ctrl-C / tsx-watch restart into an orphaned 8787 listener).
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
