import Fastify, { type FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import type { Engine } from '../engine/types.js';
import type { WorkspaceSerializer } from '../util/serializer.js';
import type { PublishStore } from '../publish/store.js';
import type { AgentRunner } from '../agent/types.js';
import { toPlainText } from '../publish/markdown.js';
import multipart from '@fastify/multipart';
import { extractText, referencePath } from '../upload/extract.js';

function deriveTitle(content: string, path: string): string {
  const h = content.split('\n').find((l) => l.startsWith('# '));
  return h ? h.replace(/^#\s+/, '').trim() : (path.split('/').pop() ?? path);
}

function buildSeed(template: string, id: string): Record<string, string> {
  const seed: Record<string, string> = { 'README.md': `# ${id}\n\nA Commons workspace.\n` };
  if (template === 'content-calendar') {
    seed['brand-voice.md'] = '# Brand voice\n\nDescribe the tone and style here.\n';
    seed['audience.md'] = '# Audience\n\nDescribe who this content is for.\n';
    seed['items/.gitkeep'] = '';
  }
  return seed;
}

export function buildApi(
  engine: Engine,
  serializer: WorkspaceSerializer,
  publishStore: PublishStore,
  agentRunner?: AgentRunner,
): FastifyInstance {
  const app = Fastify();
  app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  app.get('/api/workspaces', async () => engine.listWorkspaces());

  // Upload human-provided source material (.md/.txt/.pdf/.docx) into reference/.
  // Extracted to text and written straight to main (no review gate).
  app.post('/api/workspaces/:ws/files', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const data = await req.file();
    if (!data) return reply.code(400).send({ error: 'no file uploaded' });
    let text: string;
    try {
      text = await extractText(data.filename, await data.toBuffer());
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
    const path = referencePath(data.filename);
    await serializer.run(ws, () => engine.addFile(ws, path, text));
    return reply.code(201).send({ path });
  });

  app.post('/api/workspaces', async (req, reply) => {
    const { id, template } = (req.body ?? {}) as { id?: string; template?: string };
    if (!id) return reply.code(400).send({ error: 'id required' });
    try {
      await serializer.run(id, () => engine.createWorkspace({ id, seed: buildSeed(template ?? 'blank', id) }));
      return reply.code(201).send({ id });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/proposals', async (req) => {
    const { ws } = req.params as { ws: string };
    return engine.listProposals(ws);
  });

  app.get('/api/workspaces/:ws/proposals/:id/diff', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return engine.diffProposal(ws, id);
  });

  // The proposed (final) version of a changed file — used by the reading view.
  app.get('/api/workspaces/:ws/proposals/:id/file', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      return { path, content: await engine.readProposalFile(ws, id, path) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/state', async (req) => {
    const { ws } = req.params as { ws: string };
    return engine.readState(ws);
  });

  app.delete('/api/workspaces/:ws/file', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      await serializer.run(ws, () => engine.deleteFile(ws, path));
      return { deleted: true, path };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/file', async (req) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) throw new Error('path query param required');
    return { path, content: await engine.readFile(ws, path) };
  });

  app.post('/api/workspaces/:ws/proposals/:id/approve', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return serializer.run(ws, () => engine.mergeProposal(ws, id));
  });

  app.post('/api/workspaces/:ws/proposals/:id/reject', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    await serializer.run(ws, () => engine.discardProposal(ws, id));
    return reply.send({ discarded: true });
  });

  app.get('/api/workspaces/:ws/config', async (req) => {
    const { ws } = req.params as { ws: string };
    return publishStore.getConfig(ws);
  });

  app.put('/api/workspaces/:ws/config', async (req) => {
    const { ws } = req.params as { ws: string };
    const { webhookUrl } = (req.body ?? {}) as { webhookUrl?: string };
    await serializer.run(ws, async () => publishStore.setConfig(ws, { webhookUrl }));
    return { ok: true };
  });

  app.get('/api/workspaces/:ws/published', async (req) => {
    const { ws } = req.params as { ws: string };
    return publishStore.listPublished(ws);
  });

  app.post('/api/workspaces/:ws/publish', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path required' });
    const { webhookUrl } = publishStore.getConfig(ws);
    if (!webhookUrl) return reply.code(400).send({ error: 'no webhook configured for this workspace' });

    let content: string;
    try { content = await engine.readFile(ws, path); }
    catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }); }

    const title = deriveTitle(content, path);
    const text = toPlainText(content);
    try {
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: ws, path, title, content, text }),
      });
      if (!r.ok) return reply.code(502).send({ error: `webhook returned ${r.status}` });
    } catch (e) {
      return reply.code(502).send({ error: `webhook failed: ${e instanceof Error ? e.message : String(e)}` });
    }

    const rec = await serializer.run(ws, async () => publishStore.markPublished(ws, path));
    return { published: true, publishedAt: rec.publishedAt, title };
  });

  app.post('/api/workspaces/:ws/agent', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    if (!/^[A-Za-z0-9_-]+$/.test(ws)) return reply.code(400).send({ error: 'invalid workspace id' });
    const workspaces = await engine.listWorkspaces();
    if (!workspaces.includes(ws)) return reply.code(404).send({ error: `workspace '${ws}' not found` });
    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || !prompt.trim()) return reply.code(400).send({ error: 'prompt required' });
    if (!agentRunner) return reply.code(503).send({ error: 'agent not configured on this server' });

    reply.header('content-type', 'application/x-ndjson');
    const stream = new Readable({ read() {} });
    const write = (e: unknown) => stream.push(JSON.stringify(e) + '\n');
    agentRunner
      .run(ws, prompt, write)
      .catch((e) => write({ type: 'error', message: e instanceof Error ? e.message : String(e) }))
      .finally(() => stream.push(null));
    return reply.send(stream);
  });

  return app;
}
