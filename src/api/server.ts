import Fastify, { type FastifyInstance } from 'fastify';
import type { Engine } from '../engine/types.js';
import type { WorkspaceSerializer } from '../util/serializer.js';

export function buildApi(engine: Engine, serializer: WorkspaceSerializer): FastifyInstance {
  const app = Fastify();

  app.get('/api/workspaces', async () => engine.listWorkspaces());

  app.get('/api/workspaces/:ws/proposals', async (req) => {
    const { ws } = req.params as { ws: string };
    return engine.listProposals(ws);
  });

  app.get('/api/workspaces/:ws/proposals/:id/diff', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return engine.diffProposal(ws, id);
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

  return app;
}
