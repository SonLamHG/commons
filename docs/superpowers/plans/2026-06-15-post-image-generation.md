# Post Image Generation (Gemini) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let agents generate images for posts via the Gemini API during a proposal, so a human reviews the image alongside the text and the image is attached when publishing.

**Architecture:** A provider-agnostic `ImageGenerator` (Gemini default) is injected into the MCP tool layer. A new `generate_image` tool writes image bytes into the proposal worktree. The engine gains binary read/write methods (text methods untouched). The API serves image bytes and attaches the post's first image as base64 to the publish webhook. The review UI renders images inline.

**Tech Stack:** TypeScript (ESM via tsx), simple-git, Fastify, `@google/genai`, React 19 + Vite, vitest.

---

## File Structure

- Create `src/image/types.ts` — `ImageGenerator` interface + `GeneratedImage` type.
- Create `src/image/gemini.ts` — Gemini implementation + factory `createImageGenerator()`.
- Modify `src/engine/types.ts` — add binary methods to `Engine`.
- Modify `src/engine/index.ts` — implement `writeProposalFileBytes`, `readFileBytes`, `readProposalFileBytes`.
- Modify `src/mcp/tools.ts` — add `imageGenerator` to `ToolDeps`; add `generate_image` tool.
- Modify `src/mcp/server.ts` — construct the generator and pass it to `createTools`.
- Modify `src/agent/options.ts` — allow `generate_image`, mention it in the prompt, pass `GEMINI_API_KEY` to the stdio subprocess.
- Modify `src/api/server.ts` — add `/asset` routes; attach image to publish payload.
- Modify `web/src/api.ts` — add asset URL helpers.
- Modify `web/src/markdown.ts` — render `![alt](src)` images with a base-URL resolver.
- Modify `web/src/components/DiffView.tsx` and `web/src/components/FileBrowser.tsx` — render image files inline.
- Modify `PUBLISHING.md` — document the `image` payload field.
- Tests: `test/engine.test.ts`, `test/api.test.ts`, `test/tools.test.ts` (create if absent).

---

## Task 1: Image generator interface + Gemini implementation

**Files:**
- Create: `src/image/types.ts`
- Create: `src/image/gemini.ts`
- Modify: `package.json` (add `@google/genai` dependency)

- [ ] **Step 1: Add the dependency**

Run: `npm install @google/genai`
Expected: `package.json` gains `@google/genai` under dependencies; install succeeds.

- [ ] **Step 2: Write the interface**

Create `src/image/types.ts`:

```ts
export interface GeneratedImage {
  bytes: Buffer;
  mime: string; // e.g. 'image/png'
}

export interface ImageGenerator {
  generate(opts: {
    prompt: string;
    aspectRatio?: '1:1' | '16:9' | '9:16';
  }): Promise<GeneratedImage>;
}
```

- [ ] **Step 3: Write the Gemini implementation**

Create `src/image/gemini.ts`:

```ts
import { GoogleGenAI } from '@google/genai';
import type { GeneratedImage, ImageGenerator } from './types.js';

/** Default image model (Nano Banana). Override with COMMONS_IMAGE_MODEL. */
const DEFAULT_MODEL = 'gemini-2.5-flash-image';

export function createImageGenerator(): ImageGenerator {
  return {
    async generate({ prompt, aspectRatio }) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY is not set — cannot generate images.');
      }
      const ai = new GoogleGenAI({ apiKey });
      const model = process.env.COMMONS_IMAGE_MODEL ?? DEFAULT_MODEL;
      const fullPrompt = aspectRatio
        ? `${prompt}\n\n(aspect ratio: ${aspectRatio})`
        : prompt;

      const res = await ai.models.generateContent({
        model,
        contents: fullPrompt,
        config: { responseModalities: ['IMAGE'] },
      });

      const parts = res.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        const data = part.inlineData?.data;
        if (data) {
          return {
            bytes: Buffer.from(data, 'base64'),
            mime: part.inlineData?.mimeType ?? 'image/png',
          };
        }
      }
      throw new Error('Gemini returned no image data.');
    },
  };
}
```

- [ ] **Step 4: Type-check compiles**

Run: `npx tsc --noEmit`
Expected: no errors from `src/image/*`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/image/types.ts src/image/gemini.ts
git commit -m "feat(image): add Gemini-backed ImageGenerator"
```

---

## Task 2: Engine binary read/write methods

**Files:**
- Modify: `src/engine/types.ts:28-44`
- Modify: `src/engine/index.ts`
- Test: `test/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/engine.test.ts` (inside the existing describe block; reuse the existing `engine`/workspace setup pattern in that file — create a workspace and proposal first if the test is standalone):

```ts
it('round-trips binary files through a proposal and merge', async () => {
  const ws = 'bin-ws';
  await engine.createWorkspace({ id: ws, seed: { 'README.md': '# x\n' } });
  await engine.createProposal(ws, { id: 'p1', title: 'add image' });

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  await engine.writeProposalFileBytes(ws, 'p1', 'assets/cover.png', png);

  const inProposal = await engine.readProposalFileBytes(ws, 'p1', 'assets/cover.png');
  expect(Buffer.compare(inProposal, png)).toBe(0);

  await engine.submitProposal(ws, 'p1', 'add cover');
  const res = await engine.mergeProposal(ws, 'p1');
  expect(res.merged).toBe(true);

  const onMain = await engine.readFileBytes(ws, 'assets/cover.png');
  expect(Buffer.compare(onMain, png)).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine.test.ts -t "round-trips binary"`
Expected: FAIL — `engine.writeProposalFileBytes is not a function`.

- [ ] **Step 3: Add methods to the Engine interface**

In `src/engine/types.ts`, add to the `Engine` interface (after `writeProposalFile` / `readProposalFile`):

```ts
  writeProposalFileBytes(workspaceId: string, proposalId: string, path: string, bytes: Buffer): Promise<void>;
  readProposalFileBytes(workspaceId: string, proposalId: string, path: string): Promise<Buffer>;
  readFileBytes(workspaceId: string, path: string): Promise<Buffer>;
```

- [ ] **Step 4: Implement in the engine**

In `src/engine/index.ts`, add these methods inside the returned object (place next to `readFile` / `writeProposalFile`):

```ts
    async readFileBytes(workspaceId, path) {
      return readFileSync(safeJoin(repoPath(workspaceId), path));
    },

    async readProposalFileBytes(workspaceId, proposalId, path) {
      const proposal = readMeta(workspaceId).find((p) => p.id === proposalId);
      if (!proposal) throw new Error(`proposal not found: ${proposalId}`);
      if (proposal.status === 'merged' || proposal.status === 'discarded') {
        throw new Error(`proposal ${proposalId} is ${proposal.status} (no worktree)`);
      }
      return readFileSync(safeJoin(worktreePath(workspaceId, proposalId), path));
    },

    async writeProposalFileBytes(workspaceId, proposalId, path, bytes) {
      const proposal = readMeta(workspaceId).find((p) => p.id === proposalId);
      if (!proposal) throw new Error(`proposal not found: ${proposalId}`);
      if (proposal.status === 'merged' || proposal.status === 'discarded') {
        throw new Error(`proposal ${proposalId} is ${proposal.status} (no worktree)`);
      }
      const wt = worktreePath(workspaceId, proposalId);
      const abs = safeJoin(wt, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
    },
```

Note: `readFileSync` with no encoding returns a `Buffer` — that is the only difference from the text variants.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/engine.test.ts -t "round-trips binary"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/index.ts test/engine.test.ts
git commit -m "feat(engine): binary read/write for proposal and main files"
```

---

## Task 3: MCP `generate_image` tool

**Files:**
- Modify: `src/mcp/tools.ts:12-18` (ToolDeps) and tool list
- Modify: `src/mcp/server.ts:9`
- Test: `test/tools.test.ts` (create if it does not exist)

- [ ] **Step 1: Write the failing test**

Create (or append to) `test/tools.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/engine/index.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { generateId } from '../src/util/id.js';
import { createTools } from '../src/mcp/tools.js';
import type { ImageGenerator } from '../src/image/types.js';

describe('generate_image tool', () => {
  let root: string;
  let tools: ReturnType<typeof createTools>;

  const fakeGen: ImageGenerator = {
    async generate() {
      return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mime: 'image/png' };
    },
  };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'commons-tools-'));
    const engine = createEngine(root);
    tools = createTools({ engine, serializer: new WorkspaceSerializer(), genId: generateId, imageGenerator: fakeGen });
    await engine.createWorkspace({ id: 'ws', seed: { 'README.md': '# x\n' } });
    const create = tools.find((t) => t.name === 'create_proposal')!;
    await create.run({ workspace: 'ws', title: 'p' }); // returns id, but we set our own below
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes the generated image into the proposal worktree', async () => {
    const createTool = tools.find((t) => t.name === 'create_proposal')!;
    const id = await createTool.run({ workspace: 'ws', title: 'img' });
    const gen = tools.find((t) => t.name === 'generate_image')!;
    const out = await gen.run({ workspace: 'ws', proposalId: id, prompt: 'a cat', path: 'assets/cat.png' });
    expect(out).toContain('assets/cat.png');

    const readTool = tools.find((t) => t.name === 'diff_proposal')!;
    const diff = await readTool.run({ workspace: 'ws', proposalId: id });
    expect(diff).toContain('assets/cat.png');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/tools.test.ts`
Expected: FAIL — `imageGenerator` not in `ToolDeps` / no `generate_image` tool.

- [ ] **Step 3: Extend ToolDeps**

In `src/mcp/tools.ts`, update the imports and `ToolDeps`:

```ts
import type { ImageGenerator } from '../image/types.js';
```

```ts
export interface ToolDeps {
  engine: Engine;
  serializer: WorkspaceSerializer;
  genId: (prefix?: string) => string;
  imageGenerator: ImageGenerator;
}
```

And update the destructure:

```ts
export function createTools({ engine, serializer, genId, imageGenerator }: ToolDeps): ToolDef[] {
```

- [ ] **Step 4: Add the tool**

In `src/mcp/tools.ts`, add this tool object to the returned array (place after `write_proposal_file`):

```ts
    {
      name: 'generate_image',
      description:
        'Generate an image for a post and save it inside a proposal worktree. ' +
        'Save under assets/ (e.g. assets/<item>/cover.png). After it succeeds, reference ' +
        'the image in your post Markdown with ![alt](<relative path to the image>) so it ' +
        'shows up in review and gets attached when published.',
      inputSchema: {
        workspace: z.string(),
        proposalId: z.string(),
        prompt: z.string(),
        path: z.string(),
        aspectRatio: z.enum(['1:1', '16:9', '9:16']).optional(),
      },
      run: async ({ workspace, proposalId, prompt, path, aspectRatio }) => {
        let image;
        try {
          image = await imageGenerator.generate({ prompt, aspectRatio });
        } catch (e) {
          return `image generation failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        await serializer.run(workspace, () =>
          engine.writeProposalFileBytes(workspace, proposalId, path, image.bytes),
        );
        const kb = Math.round(image.bytes.length / 1024);
        return `wrote ${path} (${image.mime}, ${kb}KB). Reference it in your post as ![alt](${path}).`;
      },
    },
```

- [ ] **Step 5: Inject the generator in buildServer**

In `src/mcp/server.ts`:

```ts
import { createImageGenerator } from '../image/gemini.js';
```

```ts
  const tools = createTools({
    engine,
    serializer: new WorkspaceSerializer(),
    genId: generateId,
    imageGenerator: createImageGenerator(),
  });
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/tools.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/mcp/tools.ts src/mcp/server.ts test/tools.test.ts
git commit -m "feat(mcp): add generate_image tool"
```

---

## Task 4: Expose the tool to the in-app agent

**Files:**
- Modify: `src/agent/options.ts:7-17` (allowlist), `:29-42` (prompt), `:63-70` (subprocess env)

- [ ] **Step 1: Add the tool to the allowlist**

In `src/agent/options.ts`, add `'generate_image'` to the `COMMONS_TOOLS` array (after `'write_proposal_file'`):

```ts
  'write_proposal_file',
  'generate_image',
```

- [ ] **Step 2: Mention image generation in the system prompt**

In `systemPrompt`, change the step-3 line and rules to include images:

```ts
    `3. write_proposal_file for each file you add or change (Markdown). When an image would strengthen the post, call generate_image to create one under assets/ and reference it in the Markdown with ![alt](path).`,
```

- [ ] **Step 3: Pass GEMINI_API_KEY to the stdio subprocess**

In `buildAgentOptions`, the stdio server env currently only forwards `COMMONS_ROOT`. Update it so image generation works inside the subprocess:

```ts
        env: {
          COMMONS_ROOT: absRoot,
          ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
          ...(process.env.COMMONS_IMAGE_MODEL ? { COMMONS_IMAGE_MODEL: process.env.COMMONS_IMAGE_MODEL } : {}),
        },
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/agent/options.ts
git commit -m "feat(agent): allow generate_image and forward GEMINI_API_KEY"
```

---

## Task 5: API routes to serve image bytes

**Files:**
- Modify: `src/api/server.ts` (add two GET routes + a MIME helper)
- Test: `test/api.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/api.test.ts` (reuse the file's existing app/engine setup helpers; the snippet below assumes a helper that builds the app over a temp root — match the existing pattern in that file):

```ts
it('serves a merged image as bytes with the right content-type', async () => {
  const { app, engine } = await buildTestApp(); // existing helper pattern in this file
  await engine.createWorkspace({ id: 'imgws', seed: { 'README.md': '# x\n' } });
  await engine.createProposal('imgws', { id: 'p1', title: 't' });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
  await engine.writeProposalFileBytes('imgws', 'p1', 'assets/c.png', png);
  await engine.submitProposal('imgws', 'p1', 'add');
  await engine.mergeProposal('imgws', 'p1');

  const res = await app.inject({ method: 'GET', url: '/api/workspaces/imgws/asset?path=assets/c.png' });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('image/png');
  expect(Buffer.compare(res.rawPayload, png)).toBe(0);
});
```

If `test/api.test.ts` has no reusable `buildTestApp` helper, inline the same construction the other tests in that file use (createEngine over `mkdtemp`, `new WorkspaceSerializer()`, `buildApi(...)`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.ts -t "serves a merged image"`
Expected: FAIL — 404 / not JSON / route missing.

- [ ] **Step 3: Add a MIME helper**

In `src/api/server.ts`, add near the top (after imports, beside `deriveTitle`):

```ts
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
```

- [ ] **Step 4: Add the two routes**

In `src/api/server.ts`, add after the existing `/state` route (these are read-only — no serializer):

```ts
  app.get('/api/workspaces/:ws/asset', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { path } = req.query as { path?: string };
    if (!path) return reply.code(400).send({ error: 'path query param required' });
    try {
      const bytes = await engine.readFileBytes(ws, path);
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
      const bytes = await engine.readProposalFileBytes(ws, id, path);
      return reply.type(mimeForPath(path)).send(bytes);
    } catch (e) {
      return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) });
    }
  });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/api.test.ts -t "serves a merged image"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/server.ts test/api.test.ts
git commit -m "feat(api): serve proposal and main image bytes"
```

---

## Task 6: Attach the post's image to the publish webhook

**Files:**
- Modify: `src/api/server.ts:167-193` (publish route)
- Modify: `PUBLISHING.md`
- Test: `test/api.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/api.test.ts`:

```ts
it('attaches the first post image to the publish payload as base64', async () => {
  const { app, engine, serializer } = await buildTestApp(); // match existing helper
  await engine.createWorkspace({
    id: 'pubws',
    seed: {
      'items/post.md': '# Hi\n\n![cover](../assets/cover.png)\n',
      'assets/cover.png': 'PNG-bytes', // placeholder; overwritten below
    },
  });
  // overwrite with real bytes via the binary path
  await engine.addFile('pubws', 'placeholder.txt', 'x'); // keep main moving if needed
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 5, 5, 5]);
  // write the image straight to main for the test using a proposal+merge
  await engine.createProposal('pubws', { id: 'pp', title: 'img' });
  await engine.writeProposalFileBytes('pubws', 'pp', 'assets/cover.png', png);
  await engine.submitProposal('pubws', 'pp', 'img');
  await engine.mergeProposal('pubws', 'pp');

  let received: any;
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init: any) => {
    received = JSON.parse(init.body);
    return new Response(null, { status: 200 });
  });

  await app.inject({
    method: 'PUT', url: '/api/workspaces/pubws/config',
    payload: { webhookUrl: 'https://example.test/hook' },
  });
  const res = await app.inject({
    method: 'POST', url: '/api/workspaces/pubws/publish',
    payload: { path: 'items/post.md' },
  });

  expect(res.statusCode).toBe(200);
  expect(received.image.mime).toBe('image/png');
  expect(received.image.filename).toBe('cover.png');
  expect(Buffer.from(received.image.base64, 'base64').length).toBe(png.length);
  fetchSpy.mockRestore();
});
```

Add `import { vi } from 'vitest';` to the test file imports if not already present. Note: the seed `assets/cover.png` string is just a placeholder so the path resolves; the real bytes come from the merged proposal.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.ts -t "attaches the first post image"`
Expected: FAIL — payload has no `image` field.

- [ ] **Step 3: Add an image-extraction helper**

In `src/api/server.ts`, add beside `deriveTitle`:

```ts
import { posix } from 'node:path';

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
```

- [ ] **Step 4: Attach the image in the publish route**

In the `POST .../publish` handler, after `const text = toPlainText(content);` and before the `fetch`, build an optional image object and include it in the body:

```ts
    let image: { filename: string; mime: string; base64: string } | undefined;
    const imgPath = firstImagePath(content, path);
    if (imgPath) {
      try {
        const bytes = await engine.readFileBytes(ws, imgPath);
        image = {
          filename: imgPath.split('/').pop() ?? 'image',
          mime: mimeForPath(imgPath),
          base64: bytes.toString('base64'),
        };
      } catch { /* image referenced but missing — publish text-only */ }
    }
```

Then change the webhook body to include it:

```ts
        body: JSON.stringify({ workspace: ws, path, title, content, text, ...(image ? { image } : {}) }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/api.test.ts -t "attaches the first post image"`
Expected: PASS.

- [ ] **Step 6: Document the payload field**

In `PUBLISHING.md`, in the "Payload commons gửi đi" JSON block, add after the `text` line:

```jsonc
  "image": {                         // CHỈ có khi bài tham chiếu 1 ảnh trong assets/
    "filename": "cover.png",
    "mime": "image/png",
    "base64": "iVBORw0KGgo..."       // decode base64 -> file nhị phân để đăng kèm
  }
```

And add a row to the troubleshooting/notes explaining Make should map `image.base64` (decoded) as the post attachment.

- [ ] **Step 7: Commit**

```bash
git add src/api/server.ts PUBLISHING.md test/api.test.ts
git commit -m "feat(api): attach post image to publish webhook payload"
```

---

## Task 7: Render images in the review UI

**Files:**
- Modify: `web/src/api.ts:8` (add asset URL helpers + `isImage`)
- Modify: `web/src/markdown.ts:21` (image support with base-URL resolver)
- Modify: `web/src/components/DiffView.tsx:96-110`
- Modify: `web/src/components/FileBrowser.tsx:150-160`

- [ ] **Step 1: Add helpers to the web api module**

In `web/src/api.ts`, add to the exported `api` object:

```ts
  assetUrl: (ws: string, path: string): string =>
    `/api/workspaces/${ws}/asset?path=${encodeURIComponent(path)}`,
  proposalAssetUrl: (ws: string, id: string, path: string): string =>
    `/api/workspaces/${ws}/proposals/${id}/asset?path=${encodeURIComponent(path)}`,
```

And export a small predicate (top level of the file):

```ts
export const isImage = (path: string): boolean =>
  /\.(png|jpe?g|webp|gif)$/i.test(path);
```

- [ ] **Step 2: Support images in renderMarkdown**

In `web/src/markdown.ts`, change `inline` to accept an optional `resolveSrc` and handle `![alt](src)` BEFORE the link rule (so the `!` is consumed):

```ts
function inline(s: string, resolveSrc?: (src: string) => string): string {
  return s
    .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_m, alt, src) => {
      const url = resolveSrc ? resolveSrc(src) : src;
      const safe = /^(https?:\/\/|\/)/i.test(url) ? url : '#';
      return `<img src="${safe}" alt="${alt}" />`;
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, href) => {
      const safe = /^https?:\/\//i.test(href) ? href : '#';
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    })
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(\*|_)(.+?)\1/g, '<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}
```

Thread `resolveSrc` through `renderMarkdown`:

```ts
export function renderMarkdown(md: string, resolveSrc?: (src: string) => string): string {
```

and update the two internal `inline(...)` calls (in `flushPara` and the list/heading/blockquote branches) to pass `resolveSrc`, e.g.:

```ts
    if (para.length) { html.push(`<p>${inline(para.join(' '), resolveSrc)}</p>`); para = []; }
```
```ts
      html.push(`<${list.type}>${list.items.map((i) => `<li>${inline(i, resolveSrc)}</li>`).join('')}</${list.type}>`);
```
```ts
    if (h) { flushPara(); flushList(); html.push(`<h${h[1].length}>${inline(h[2], resolveSrc)}</h${h[1].length}>`); continue; }
```
```ts
    if (bq) { flushList(); flushPara(); html.push(`<blockquote>${inline(bq[1], resolveSrc)}</blockquote>`); continue; }
```

The `resolveSrc` callback maps a Markdown image `src` (workspace-relative, possibly with `../`) to an asset URL. Provide a shared helper in `web/src/markdown.ts`:

```ts
// Resolve a post-relative image src (e.g. "../assets/x.png") against the post's
// directory into a workspace-relative path, for the asset endpoints.
export function resolvePostImage(postPath: string, toUrl: (wsRelPath: string) => string) {
  const dir = postPath.includes('/') ? postPath.slice(0, postPath.lastIndexOf('/')) : '';
  return (src: string): string => {
    if (/^(https?:\/\/|data:)/i.test(src)) return src;
    const parts = (dir ? dir.split('/') : []);
    for (const seg of src.split('/')) {
      if (seg === '..') parts.pop();
      else if (seg !== '.') parts.push(seg);
    }
    return toUrl(parts.join('/'));
  };
}
```

- [ ] **Step 3: Render images in DiffView reading view**

In `web/src/components/DiffView.tsx`, import helpers:

```ts
import { api, type Proposal, type FileDiff, type MergeResult, isImage } from '../api';
import { renderMarkdown, resolvePostImage } from '../markdown';
```

In the `docs` fetch effect, skip fetching text for image files (they would return binary). Change the per-file map so image files get empty content but are still listed:

```ts
        d.map(async (f) => {
          if (f.status === 'deleted') return { path: f.path, status: f.status, content: '' };
          if (isImage(f.path)) return { path: f.path, status: f.status, content: '' };
          try { const r = await api.proposalFile(ws, proposal.id, f.path); return { path: f.path, status: f.status, content: r.content }; }
          catch { return { path: f.path, status: f.status, content: '' }; }
        }),
```

In the reading-view render, branch on image first:

```tsx
          {d.status === 'deleted'
            ? <p className="empty">Tài liệu này sẽ bị gỡ bỏ.</p>
            : isImage(d.path)
              ? <img className="post-image" src={api.proposalAssetUrl(ws, proposal.id, d.path)} alt={d.path} />
              : d.path.endsWith('.md')
                ? <div className="doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(d.content, resolvePostImage(d.path, (p) => api.proposalAssetUrl(ws, proposal.id, p))) }} />
                : <pre className="diff-body" style={{ padding: '12px' }}>{d.content}</pre>}
```

- [ ] **Step 4: Render images in FileBrowser (main view)**

In `web/src/components/FileBrowser.tsx`, import helpers:

```ts
import { api, type FileNode, isImage } from '../api';
import { renderMarkdown, resolvePostImage } from '../markdown';
```

Skip the text fetch for image files in the content effect:

```ts
    if (!selected) { setContent(null); return; }
    if (isImage(selected)) { setContent(''); return; } // image rendered via <img>, no text fetch
    let live = true;
```

In the detail render, branch on image:

```tsx
              {content !== null && (
                isImage(selected)
                  ? <img className="post-image" src={api.assetUrl(ws, selected)} alt={selected} />
                  : isMd
                    ? <div className="doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(content, resolvePostImage(selected, (p) => api.assetUrl(ws, p))) }} />
                    : (
                      <div className="diff-file">
                        <h4>{selected}</h4>
                        <pre className="diff-body" style={{ padding: '12px' }}>{content}</pre>
                      </div>
                    )
              )}
```

- [ ] **Step 5: Add minimal image styling**

In `web/src/styles.css`, add:

```css
.post-image { max-width: 100%; height: auto; border-radius: 8px; margin: 8px 0; }
.doc img { max-width: 100%; height: auto; border-radius: 8px; }
```

- [ ] **Step 6: Build the web app**

Run: `npm run build:web`
Expected: Vite build succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/api.ts web/src/markdown.ts web/src/components/DiffView.tsx web/src/components/FileBrowser.tsx web/src/styles.css
git commit -m "feat(web): render generated post images inline"
```

---

## Task 8: Full test pass

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all tests pass, including the new engine/tools/api tests.

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit any final fixups**

```bash
git add -A
git commit -m "test: full suite green for post image generation"
```

---

## Notes for the implementer

- **MCP stdio rule:** never `console.log` in any code reachable from the stdio MCP server — it corrupts the JSON-RPC channel. The Gemini call lives behind the tool, which runs inside that subprocess; keep all diagnostics on stderr.
- **Windows paths:** the engine already normalizes worktree paths; the new binary methods reuse `safeJoin` and the same `worktreePath`/`repoPath` helpers, so no extra handling is needed.
- **No new merge/discard surface:** `generate_image` only writes into a proposal worktree. The human merge gate is unchanged.
- **API key:** set `GEMINI_API_KEY` in the environment running the API/agent. Without it, `generate_image` returns a clear error string instead of throwing.
