import { join } from 'node:path';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { createEngine } from '../engine/index.js';
import { WorkspaceSerializer } from '../util/serializer.js';
import { buildApi } from './server.js';

const root = process.env.COMMONS_ROOT ?? join(process.cwd(), 'data');
const port = Number(process.env.PORT ?? 8787);

const app = buildApi(createEngine(root), new WorkspaceSerializer());

const dist = join(process.cwd(), 'web', 'dist');
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((_req, reply) => reply.sendFile('index.html')); // SPA fallback
}

app.listen({ port, host: '0.0.0.0' })
  .then(() => process.stdout.write(`commons review UI on http://localhost:${port}\n`))
  .catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1); });
