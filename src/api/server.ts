import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';
import { posix } from 'node:path';
import type { EngineRegistry } from '../engine/registry.js';
import { WorkspaceSerializer, scopeKey } from '../util/serializer.js';
import { createPublishStore, type PublishStore } from '../publish/store.js';
import type { AgentRunner } from '../agent/types.js';
import type { Db } from '../db/types.js';
import type { GoogleOAuth } from '../auth/google.js';
import { registerAuthRoutes, makeRequireAuth } from '../auth/routes.js';
import { toPlainText } from '../publish/markdown.js';
import multipart from '@fastify/multipart';
import { extractText, referencePath } from '../upload/extract.js';
import { assertPublicHttpsUrl } from '../util/ssrf.js';
import { registerSecurityHeaders } from '../security/headers.js';
import { registerCors } from '../security/cors.js';
import { registerRateLimit } from '../security/rateLimit.js';

function mimeForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    default: return 'application/octet-stream';
  }
}

/** First Markdown image reference in the post, resolved to a workspace-relative path. */
function firstImagePath(content: string, postPath: string): string | null {
  const m = /!\[[^\]]*\]\(([^)]+)\)/.exec(content);
  if (!m) return null;
  const ref = m[1].trim().split(/\s+/)[0]; // drop optional "title"
  if (/^https?:\/\//i.test(ref) || ref.startsWith('data:')) return null;
  const dir = posix.dirname(postPath.replace(/\\/g, '/'));
  const resolved = posix.normalize(posix.join(dir, ref));
  return resolved.startsWith('..') ? null : resolved;
}

function deriveTitle(content: string, path: string): string {
  const h = content.split('\n').find((l) => l.startsWith('# '));
  return h ? h.replace(/^#\s+/, '').trim() : (path.split('/').pop() ?? path);
}

function buildSeed(template: string, id: string): Record<string, string> {
  const seed: Record<string, string> = {
    'README.md': `# ${id}\n\nA Commons workspace.\n`,
    'reference/README.md':
      '# reference/\n\nSource material the agent reads: briefs, brand voice, notes. ' +
      'User uploads land here. Do not overwrite these.\n',
    'drafts/README.md':
      '# drafts/\n\nContent the agent is drafting. New drafts belong here.\n',
    'published/README.md':
      '# published/\n\nFinalized or published versions, placed here by hand.\n',
    'assets/README.md':
      '# assets/\n\nImages and supporting files.\n',
  };
  if (template === 'content-calendar') {
    seed['brand-voice.md'] = '# Brand voice\n\nDescribe the tone and style here.\n';
    seed['audience.md'] = '# Audience\n\nDescribe who this content is for.\n';
    seed['items/.gitkeep'] = '';
  }
  return seed;
}

type Authed = FastifyRequest & { auth: { userId: string; tenantId: string } };

export interface ApiDeps {
  registry: EngineRegistry;
  serializer: WorkspaceSerializer;
  db: Db;
  authSecret: string;
  appUrl: string;
  google: GoogleOAuth;
  agentRunner?: AgentRunner;
  /** Called once per new tenant to seed its demo content. */
  seedTenant?: (tenantId: string) => Promise<void>;
}

export function buildApi(deps: ApiDeps): FastifyInstance {
  const { registry, serializer, db, authSecret, appUrl, google, agentRunner, seedTenant } = deps;
  const app = Fastify({ forceCloseConnections: true, trustProxy: true });
  registerSecurityHeaders(app);
  registerCors(app, appUrl);
  registerRateLimit(app);
  app.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });

  // --- auth: mount routes, then gate everything else under /api ---
  registerAuthRoutes(app, { db, secret: authSecret, appUrl, google, seedTenant });
  const requireAuth = makeRequireAuth({ db, secret: authSecret, appUrl, google });
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;        // static / SPA
    if (req.url.startsWith('/api/auth/')) return;     // auth endpoints
    if (req.url === '/api/health') return;            // health probe
    return requireAuth(req, reply);
  });

  app.get('/api/health', async () => ({ ok: true }));

  // --- per-tenant resolution helpers (auth has set req.auth) ---
  const tenantOf = (req: FastifyRequest) => (req as Authed).auth.tenantId;
  const engineOf = (req: FastifyRequest) => registry.forTenant(tenantOf(req));
  const publishStores = new Map<string, PublishStore>();
  const publishOf = (req: FastifyRequest): PublishStore => {
    const t = tenantOf(req);
    let s = publishStores.get(t);
    if (!s) { s = createPublishStore(registry.rootFor(t), authSecret); publishStores.set(t, s); }
    return s;
  };
  const lock = <T>(req: FastifyRequest, ws: string, fn: () => Promise<T>) =>
    serializer.run(scopeKey(tenantOf(req), ws), fn);

  app.get('/api/workspaces', async (req) => engineOf(req).listWorkspaces());

  // Upload human-provided source material (.md/.txt/.pdf/.docx) into reference/.
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
    await lock(req, ws, () => engineOf(req).addFile(ws, path, text));
    return reply.code(201).send({ path });
  });

  app.post('/api/workspaces', async (req, reply) => {
    const { id, template } = (req.body ?? {}) as { id?: string; template?: string };
    if (!id) return reply.code(400).send({ error: 'id required' });
    try {
      await lock(req, id, () => engineOf(req).createWorkspace({ id, seed: buildSeed(template ?? 'blank', id) }));
      return reply.code(201).send({ id });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/workspaces/:ws', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const workspaces = await engineOf(req).listWorkspaces();
    if (!workspaces.includes(ws)) return reply.code(404).send({ error: `workspace '${ws}' not found` });
    try {
      await lock(req, ws, () => engineOf(req).deleteWorkspace(ws));
      return reply.code(200).send({ deleted: ws });
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/proposals', async (req) => {
    const { ws } = req.params as { ws: string };
    return engineOf(req).listProposals(ws);
  });

  // Diff stats (files / +/−) for the still-active proposals, keyed by id. Computed
  // on demand (git numstat) rather than stored, so it never drifts. Resolved
  // proposals have no branch and are omitted.
  app.get('/api/workspaces/:ws/proposals/stats', async (req) => {
    const { ws } = req.params as { ws: string };
    const eng = engineOf(req);
    const active = (await eng.listProposals(ws)).filter((p) => p.status === 'submitted' || p.status === 'open');
    const out: Record<string, { files: number; additions: number; deletions: number }> = {};
    await Promise.all(active.map(async (p) => {
      try { out[p.id] = await eng.proposalStats(ws, p.id); } catch { /* skip unreadable */ }
    }));
    return out;
  });

  app.get('/api/workspaces/:ws/proposals/:id/diff', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return engineOf(req).diffProposal(ws, id);
  });

  app.get('/api/workspaces/:ws/proposals/:id/file', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      return { path, content: await engineOf(req).readProposalFile(ws, id, path) };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/state', async (req) => {
    const { ws } = req.params as { ws: string };
    return engineOf(req).readState(ws);
  });

  app.get('/api/workspaces/:ws/asset', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      const bytes = await engineOf(req).readFileBytes(ws, path);
      return reply.type(mimeForPath(path)).send(bytes);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/proposals/:id/asset', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      const bytes = await engineOf(req).readProposalFileBytes(ws, id, path);
      return reply.type(mimeForPath(path)).send(bytes);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.delete('/api/workspaces/:ws/file', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      await lock(req, ws, () => engineOf(req).deleteFile(ws, path));
      return { deleted: true, path };
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/api/workspaces/:ws/file', async (req) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) throw new Error('path query param required');
    return { path, content: await engineOf(req).readFile(ws, path) };
  });

  app.post('/api/workspaces/:ws/proposals/:id/approve', async (req) => {
    const { ws, id } = req.params as { ws: string; id: string };
    return lock(req, ws, () => engineOf(req).mergeProposal(ws, id));
  });

  app.post('/api/workspaces/:ws/proposals/:id/reject', async (req, reply) => {
    const { ws, id } = req.params as { ws: string; id: string };
    await lock(req, ws, () => engineOf(req).discardProposal(ws, id));
    return reply.send({ discarded: true });
  });

  app.get('/api/workspaces/:ws/config', async (req) => {
    const { ws } = req.params as { ws: string };
    return publishOf(req).getConfig(ws);
  });

  app.put('/api/workspaces/:ws/config', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { webhookUrl } = (req.body ?? {}) as { webhookUrl?: string };
    if (webhookUrl) {
      try { await assertPublicHttpsUrl(webhookUrl); }
      catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }); }
    }
    await lock(req, ws, async () => publishOf(req).setConfig(ws, { webhookUrl }));
    return { ok: true };
  });

  app.get('/api/workspaces/:ws/published', async (req) => {
    const { ws } = req.params as { ws: string };
    return publishOf(req).listPublished(ws);
  });

  app.post('/api/workspaces/:ws/publish', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = (req.body ?? {}) as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path required' });
    const { webhookUrl } = publishOf(req).getConfig(ws);
    if (!webhookUrl) return reply.code(400).send({ error: 'no webhook configured for this workspace' });

    let content: string;
    try { content = await engineOf(req).readFile(ws, path); }
    catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }); }

    const title = deriveTitle(content, path);
    const text = toPlainText(content);

    let image: { filename: string; mime: string; base64: string } | undefined;
    const imgPath = firstImagePath(content, path);
    if (imgPath) {
      try {
        const bytes = await engineOf(req).readFileBytes(ws, imgPath);
        image = {
          filename: imgPath.split('/').pop() ?? 'image',
          mime: mimeForPath(imgPath),
          base64: bytes.toString('base64'),
        };
      } catch { /* image referenced but missing — publish text-only */ }
    }

    try {
      await assertPublicHttpsUrl(webhookUrl);   // re-resolve at send time
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: ws, path, title, content, text, ...(image ? { image } : {}) }),
      });
      if (!r.ok) return reply.code(502).send({ error: `webhook returned ${r.status}` });
    } catch (e) {
      return reply.code(502).send({ error: `webhook failed: ${e instanceof Error ? e.message : String(e)}` });
    }

    const rec = await lock(req, ws, async () => publishOf(req).markPublished(ws, path));
    return { published: true, publishedAt: rec.publishedAt, title };
  });

  app.post('/api/workspaces/:ws/agent', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    if (!/^[A-Za-z0-9_-]+$/.test(ws)) return reply.code(400).send({ error: 'invalid workspace id' });
    const workspaces = await engineOf(req).listWorkspaces();
    if (!workspaces.includes(ws)) return reply.code(404).send({ error: `workspace '${ws}' not found` });
    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || !prompt.trim()) return reply.code(400).send({ error: 'prompt required' });
    if (!agentRunner) return reply.code(503).send({ error: 'agent not configured on this server' });

    reply.header('content-type', 'application/x-ndjson');
    const stream = new Readable({ read() {} });
    const write = (e: unknown) => stream.push(JSON.stringify(e) + '\n');
    // Snapshot existing proposals so we can attribute any created during this run
    // back to the prompt that produced them (shown as agent context in review).
    const before = new Set((await engineOf(req).listProposals(ws)).map((p) => p.id));
    agentRunner
      .run(registry.rootFor(tenantOf(req)), ws, prompt, write)
      .catch((e) => write({ type: 'error', message: e instanceof Error ? e.message : String(e) }))
      .finally(async () => {
        try {
          const fresh = (await engineOf(req).listProposals(ws)).filter((p) => !before.has(p.id) && !p.prompt);
          for (const p of fresh) {
            await lock(req, ws, () => engineOf(req).setProposalPrompt(ws, p.id, prompt.trim()));
          }
        } catch { /* best-effort attribution */ }
        stream.push(null);
      });
    return reply.send(stream);
  });

  return app;
}
