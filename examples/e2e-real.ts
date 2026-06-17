// NOTE: This file is known-broken. It uses old API signatures (pre-SaaS refactor).
// See SAAS_BETA_ARCHITECTURE.md build-order for context. Do not run without updating.
/**
 * REAL end-to-end test: loads .env, calls the real Gemini generator through the
 * generate_image tool, then drives engine -> API asset routes -> publish webhook,
 * verifying the actual image bytes round-trip. Also writes data/e2e-real.png.
 * Run: npx tsx examples/e2e-real.ts
 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { loadEnv } from '../src/util/env.js';
import { createEngine } from '../src/engine/index.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { createPublishStore } from '../src/publish/store.js';
import { buildApi } from '../src/api/server.js';
import { createTools } from '../src/mcp/tools.js';
import { generateId } from '../src/util/id.js';
import { createImageGenerator } from '../src/image/gemini.js';

loadEnv();
const log = (s: string) => process.stdout.write(s + '\n');
let passed = 0;
const check = (n: string, c: boolean) => { log(`${c ? '  ✅' : '  ❌'} ${n}`); if (!c) throw new Error('FAILED: ' + n); passed++; };

const main = async () => {
  check('GEMINI_API_KEY present (from .env)', !!process.env.GEMINI_API_KEY);
  log(`  using key ...${process.env.GEMINI_API_KEY!.slice(-4)}, model ${process.env.COMMONS_IMAGE_MODEL ?? 'gemini-2.5-flash-image'}`);

  const root = mkdtempSync(join(tmpdir(), 'commons-real-'));
  const engine = createEngine(root);
  const serializer = new WorkspaceSerializer();
  const api = buildApi(engine, serializer, createPublishStore(root));
  const tools = createTools({ engine, serializer, genId: generateId, imageGenerator: createImageGenerator() });

  const ws = 'content-calendar';
  await engine.createWorkspace({ id: ws, seed: { 'README.md': '# x\n' } });
  const id = await tools.find((t) => t.name === 'create_proposal')!.run({ workspace: ws, title: 'Real cover' });
  await tools.find((t) => t.name === 'write_proposal_file')!.run({ workspace: ws, proposalId: id,
    path: 'items/launch/post.md', content: '# Launch\n\n![cover](../../assets/launch/cover.png)\n' });

  log('\n[1] Real Gemini generation via generate_image tool…');
  const out = await tools.find((t) => t.name === 'generate_image')!.run({ workspace: ws, proposalId: id,
    prompt: 'A clean minimalist editorial cover for a B2B SaaS product launch, warm tones, no text', path: 'assets/launch/cover.png', aspectRatio: '16:9' });
  log('  tool -> ' + out);
  check('tool reported success (not "failed")', !out.startsWith('image generation failed'));

  log('\n[2] Image bytes were written & served by the API');
  const propAsset = await api.inject({ method: 'GET', url: `/api/workspaces/${ws}/proposals/${id}/asset?path=assets/launch/cover.png` });
  check('proposal asset 200', propAsset.statusCode === 200);
  check('content-type image/*', String(propAsset.headers['content-type']).startsWith('image/'));
  check('looks like real PNG (magic bytes + size)', propAsset.rawPayload.length > 1000 && propAsset.rawPayload[0] === 0x89 && propAsset.rawPayload[1] === 0x50);
  // Save it so the human can open and eyeball it.
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });
  const outPng = join(process.cwd(), 'data', 'e2e-real.png');
  writeFileSync(outPng, propAsset.rawPayload);
  log(`  saved ${propAsset.rawPayload.length} bytes -> ${outPng}`);

  log('\n[3] Submit, merge, then publish attaches the image as base64');
  await tools.find((t) => t.name === 'submit_proposal')!.run({ workspace: ws, proposalId: id, message: 'launch + cover' });
  const merge = await api.inject({ method: 'POST', url: `/api/workspaces/${ws}/proposals/${id}/approve` });
  check('merge ok', JSON.parse(merge.payload).merged === true);
  let received: any = null;
  const hook = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { received = JSON.parse(b); res.writeHead(200); res.end(); }); });
  await new Promise<void>((r) => hook.listen(0, r));
  const port = (hook.address() as any).port;
  await api.inject({ method: 'PUT', url: `/api/workspaces/${ws}/config`, payload: { webhookUrl: `http://127.0.0.1:${port}/h` } });
  const pub = await api.inject({ method: 'POST', url: `/api/workspaces/${ws}/publish`, payload: { path: 'items/launch/post.md' } });
  hook.close();
  check('publish 200', pub.statusCode === 200);
  check('webhook got image.base64 matching served bytes', Buffer.compare(Buffer.from(received.image.base64, 'base64'), propAsset.rawPayload) === 0);

  rmSync(root, { recursive: true, force: true });
  log(`\nALL ${passed} CHECKS PASSED ✅  — open data/e2e-real.png to see the real generated image.`);
};
main().catch((e) => { log('\n' + (e instanceof Error ? e.message : String(e))); process.exit(1); });
