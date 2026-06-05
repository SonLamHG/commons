import Fastify, { type FastifyInstance } from 'fastify';
import type { Engine } from '../engine/types.js';
import type { WorkspaceSerializer } from '../util/serializer.js';
import type { PublishStore } from '../publish/store.js';

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

export function buildApi(engine: Engine, serializer: WorkspaceSerializer, publishStore: PublishStore): FastifyInstance {
  const app = Fastify();

  app.get('/api/workspaces', async () => engine.listWorkspaces());

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

  app.get('/api/workspaces/:ws/state', async (req) => {
    const { ws } = req.params as { ws: string };
    return engine.readState(ws);
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
    try {
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: ws, path, title, content }),
      });
      if (!r.ok) return reply.code(502).send({ error: `webhook returned ${r.status}` });
    } catch (e) {
      return reply.code(502).send({ error: `webhook failed: ${e instanceof Error ? e.message : String(e)}` });
    }

    const rec = await serializer.run(ws, async () => publishStore.markPublished(ws, path));
    return { published: true, publishedAt: rec.publishedAt, title };
  });

  return app;
}
