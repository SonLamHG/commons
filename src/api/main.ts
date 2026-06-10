import { join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { createEngine } from '../engine/index.js';
import { WorkspaceSerializer } from '../util/serializer.js';
import { buildApi } from './server.js';
import { createPublishStore } from '../publish/store.js';
import { createClaudeRunner } from '../agent/runner.js';

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
  .catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1); });
