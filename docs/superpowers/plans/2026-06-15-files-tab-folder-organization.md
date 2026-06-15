# Files tab — folder organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every workspace a role-based standard folder layout and render the Files tab as a collapsible folder tree instead of a flat list.

**Architecture:** Three independent slices. (1) Backend convention: `buildSeed` creates `reference/ drafts/ published/ assets/` each with a README. (2) Soft agent guidance: extend the `write_proposal_file` MCP tool description. (3) Frontend: a pure `buildTree` helper (unit-tested) plus a recursive `FileTree` component that `FileBrowser` renders.

**Tech Stack:** TypeScript (ESM, tsx), Fastify, React 19 + Vite, vitest. Tests live under `test/` and (for the pure web helper) `web/src/`; `npm test` globs both.

**Spec:** [docs/superpowers/specs/2026-06-15-files-tab-folder-organization-design.md](../specs/2026-06-15-files-tab-folder-organization-design.md)

---

## File Structure

- `src/api/server.ts` — `buildSeed` modified to emit the four standard dirs (+READMEs) for every template.
- `test/api.test.ts` — add a test asserting a fresh workspace contains the four READMEs.
- `src/mcp/tools.ts` — extend `write_proposal_file` description (string-only change).
- `web/src/tree.ts` — **new**: pure `buildTree(nodes)` + `TreeNode` type + `folderLabel(name)`.
- `web/src/tree.test.ts` — **new**: unit tests for `buildTree`.
- `web/src/components/FileTree.tsx` — **new**: recursive collapsible tree view.
- `web/src/components/FileBrowser.tsx` — use `dir`+`file` nodes; render `FileTree` instead of the flat `.map`.

---

## Task 1: Standard folders in the workspace seed

**Files:**
- Modify: `src/api/server.ts:16-24` (`buildSeed`)
- Test: `test/api.test.ts`

- [ ] **Step 1: Write the failing test**

Add this test inside the top-level `describe` in `test/api.test.ts` (it follows the existing pattern of building an app over a temp engine — reuse whatever `buildApp`/setup helper the surrounding tests use; the assertion is the new part):

```ts
it('seeds the four standard role folders', async () => {
  const res = await app.inject({
    method: 'POST', url: '/api/workspaces',
    payload: { id: 'folders-ws', template: 'blank' },
  });
  expect(res.statusCode).toBe(201);

  const state = await app.inject({ method: 'GET', url: '/api/workspaces/folders-ws/state' });
  const paths = (state.json() as { path: string }[]).map((n) => n.path);
  expect(paths).toContain('reference/README.md');
  expect(paths).toContain('drafts/README.md');
  expect(paths).toContain('published/README.md');
  expect(paths).toContain('assets/README.md');
});
```

If `test/api.test.ts` does not already construct `app` in a shared `beforeEach`, mirror the construction used by the nearest existing test in that file (build engine over a `mkdtemp` dir, `buildApi(...)`, `await app.ready()`), and tear it down in `afterEach`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.ts -t "standard role folders"`
Expected: FAIL — `paths` does not contain `reference/README.md`.

- [ ] **Step 3: Implement the seed change**

Replace the body of `buildSeed` in `src/api/server.ts` so the four folders are created for every template, before any template-specific files:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/api.test.ts -t "standard role folders"`
Expected: PASS.

- [ ] **Step 5: Run the full suite (seed change touches shared fixtures)**

Run: `npm test`
Expected: all green. If a pre-existing test asserted an exact file count for a fresh workspace, update it to account for the four new READMEs.

- [ ] **Step 6: Commit**

```bash
git add src/api/server.ts test/api.test.ts
git commit -m "feat(api): seed standard role folders in new workspaces"
```

---

## Task 2: Soft guidance in the MCP tool description

**Files:**
- Modify: `src/mcp/tools.ts:86-92` (`write_proposal_file` description)
- Test: `test/mcp-tools.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/mcp-tools.test.ts`:

```ts
it('write_proposal_file description guides agents to drafts/', () => {
  const tools = createTools({ engine, serializer, genId });
  const t = tools.find((x) => x.name === 'write_proposal_file')!;
  expect(t.description).toContain('drafts/');
});
```

Use the same `createTools(...)` construction the other tests in that file use for `engine`, `serializer`, `genId`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp-tools.test.ts -t "guides agents to drafts"`
Expected: FAIL — description does not contain `drafts/`.

- [ ] **Step 3: Update the description**

In `src/mcp/tools.ts`, change the `write_proposal_file` `description` to:

```ts
      description:
        'Write a file inside a proposal (does not touch durable state until merged by a human). ' +
        'Place drafted content under drafts/, read background from reference/, and never overwrite reference/.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/mcp-tools.test.ts -t "guides agents to drafts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts test/mcp-tools.test.ts
git commit -m "feat(mcp): guide agents toward drafts/ in write_proposal_file"
```

---

## Task 3: Pure `buildTree` helper

**Files:**
- Create: `web/src/tree.ts`
- Test: `web/src/tree.test.ts`

- [ ] **Step 1: Write the failing test**

Create `web/src/tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildTree, folderLabel } from './tree';

describe('buildTree', () => {
  it('nests files under their directories', () => {
    const tree = buildTree([
      { path: 'reference', type: 'dir' },
      { path: 'reference/a.md', type: 'file' },
      { path: 'drafts', type: 'dir' },
      { path: 'drafts/b.md', type: 'file' },
    ]);
    expect(tree.map((n) => n.name)).toEqual(['reference', 'drafts']);
    const reference = tree.find((n) => n.name === 'reference')!;
    expect(reference.type).toBe('dir');
    expect(reference.children.map((c) => c.name)).toEqual(['a.md']);
    expect(reference.children[0]).toMatchObject({ path: 'reference/a.md', type: 'file' });
  });

  it('returns an empty array for no nodes', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('handles a file at the root with no directory', () => {
    const tree = buildTree([{ path: 'README.md', type: 'file' }]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ name: 'README.md', path: 'README.md', type: 'file' });
  });

  it('infers intermediate directories even if no dir node is given', () => {
    const tree = buildTree([{ path: 'assets/img/logo.png', type: 'file' }]);
    const assets = tree[0];
    expect(assets).toMatchObject({ name: 'assets', type: 'dir' });
    expect(assets.children[0]).toMatchObject({ name: 'img', type: 'dir' });
    expect(assets.children[0].children[0]).toMatchObject({ name: 'logo.png', type: 'file' });
  });
});

describe('folderLabel', () => {
  it('maps standard folders to friendly labels', () => {
    expect(folderLabel('reference')).toContain('Tư liệu nguồn');
    expect(folderLabel('drafts')).toContain('Bản nháp');
  });
  it('falls back to the raw name for unknown folders', () => {
    expect(folderLabel('campaign-q3')).toBe('campaign-q3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/src/tree.test.ts`
Expected: FAIL — cannot resolve `./tree`.

- [ ] **Step 3: Implement `web/src/tree.ts`**

```ts
import type { FileNode } from './api';

export interface TreeNode {
  name: string;             // last path segment
  path: string;             // full path from workspace root
  type: 'file' | 'dir';
  children: TreeNode[];     // empty for files
}

/** Build a nested tree from the flat path list returned by readState.
 *  Intermediate directories are inferred from file paths, so a missing
 *  `dir` node never drops a file. Order: directories and files appear in
 *  first-seen order within each level. */
export function buildTree(nodes: FileNode[]): TreeNode[] {
  const roots: TreeNode[] = [];
  const dirIndex = new Map<string, TreeNode>(); // path -> dir node

  const ensureDir = (path: string): TreeNode => {
    const existing = dirIndex.get(path);
    if (existing) return existing;
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const node: TreeNode = { name, path, type: 'dir', children: [] };
    dirIndex.set(path, node);
    if (segments.length === 1) roots.push(node);
    else ensureDir(segments.slice(0, -1).join('/')).children.push(node);
    return node;
  };

  for (const n of nodes) {
    if (n.type === 'dir') { ensureDir(n.path); continue; }
    const segments = n.path.split('/');
    const name = segments[segments.length - 1];
    const fileNode: TreeNode = { name, path: n.path, type: 'file', children: [] };
    if (segments.length === 1) roots.push(fileNode);
    else ensureDir(segments.slice(0, -1).join('/')).children.push(fileNode);
  }

  return roots;
}

const LABELS: Record<string, string> = {
  reference: '📎 Tư liệu nguồn',
  drafts: '✍️ Bản nháp',
  published: '✅ Đã xuất bản',
  assets: '🖼️ Tài nguyên',
};

/** Friendly label for a directory name; raw name if not a standard folder. */
export function folderLabel(name: string): string {
  return LABELS[name] ?? name;
}

/** Standard top-level folders, expanded by default in the UI. */
export const STANDARD_FOLDERS = ['reference', 'drafts', 'published', 'assets'];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run web/src/tree.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/tree.ts web/src/tree.test.ts
git commit -m "feat(web): pure buildTree helper for the files tree"
```

---

## Task 4: Recursive `FileTree` component

**Files:**
- Create: `web/src/components/FileTree.tsx`

This task has no unit test (it is presentational React with no test harness in the repo); it is verified visually in Task 5 / final check. Keep logic in `buildTree` (already tested).

- [ ] **Step 1: Implement `web/src/components/FileTree.tsx`**

```tsx
import React, { useState } from 'react';
import type { TreeNode } from '../tree';
import { folderLabel, STANDARD_FOLDERS } from '../tree';

interface Props {
  nodes: TreeNode[];
  selected: string | null;
  onSelect: (path: string) => void;
  published: Record<string, { publishedAt: string }>;
  depth?: number;
}

export function FileTree({ nodes, selected, onSelect, published, depth = 0 }: Props) {
  return (
    <>
      {nodes.map((node) =>
        node.type === 'dir' ? (
          <Dir key={node.path} node={node} selected={selected} onSelect={onSelect}
               published={published} depth={depth} />
        ) : (
          <button key={node.path}
                  className={node.path === selected ? 'prop active' : 'prop'}
                  style={{ paddingLeft: 12 + depth * 16 }}
                  onClick={() => onSelect(node.path)}>
            <span className="title" style={{ fontFamily: 'monospace', fontWeight: 400 }}>{node.name}</span>
            {published[node.path] && <span className="badge merged">published</span>}
          </button>
        ),
      )}
    </>
  );
}

function Dir({ node, selected, onSelect, published, depth }: {
  node: TreeNode; selected: string | null; onSelect: (p: string) => void;
  published: Record<string, { publishedAt: string }>; depth: number;
}) {
  const [open, setOpen] = useState(depth === 0 ? STANDARD_FOLDERS.includes(node.name) : false);
  return (
    <>
      <button className="prop" style={{ paddingLeft: 12 + depth * 16, fontWeight: 600 }}
              onClick={() => setOpen((o) => !o)}>
        <span className="title">{open ? '▾' : '▸'} {depth === 0 ? folderLabel(node.name) : node.name}</span>
      </button>
      {open && (
        <FileTree nodes={node.children} selected={selected} onSelect={onSelect}
                  published={published} depth={depth + 1} />
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check (no dedicated test)**

Run: `npm run build:web`
Expected: builds without TypeScript errors. (This also compiles `FileBrowser` once Task 5 lands; if run now it may warn that `FileTree` is unused — that is fine, it should still compile.)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/FileTree.tsx
git commit -m "feat(web): recursive collapsible FileTree component"
```

---

## Task 5: Render the tree in `FileBrowser`

**Files:**
- Modify: `web/src/components/FileBrowser.tsx:20` (loadFiles filter) and `:114-126` (list render)

- [ ] **Step 1: Keep dir nodes when loading**

In `FileBrowser.tsx`, change the state type and `loadFiles` so directory nodes are retained. Replace the `files` state declaration and `loadFiles`:

```tsx
  const [files, setFiles] = useState<FileNode[] | null>(null);
```
(unchanged type — `FileNode` already covers `dir`), and change `loadFiles` to stop filtering:

```tsx
  const loadFiles = () => api.state(ws).then((nodes) => setFiles(nodes))
    .catch((e) => setError(e instanceof Error ? e.message : String(e)));
```

- [ ] **Step 2: Import the tree pieces**

Add near the top imports of `FileBrowser.tsx`:

```tsx
import { buildTree } from '../tree';
import { FileTree } from './FileTree';
```

- [ ] **Step 3: Replace the flat list render**

Replace the `files?.map(...)` block (currently `FileBrowser.tsx:120-125`) inside `<div className="list">` with:

```tsx
          {files !== null && files.length === 0 && <p className="empty">No files yet.</p>}
          {files !== null && files.length > 0 && (
            <FileTree
              nodes={buildTree(files)}
              selected={selected}
              onSelect={setSelected}
              published={published}
            />
          )}
```

Leave the surrounding `<h2>Files</h2>`, the `error` line, and the `files === null` Loading line as they are. Remove the now-duplicated `files?.length === 0` line if it precedes this block.

- [ ] **Step 4: Build to type-check**

Run: `npm run build:web`
Expected: builds clean, no unused-symbol or type errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open the web UI, create a workspace, upload a file, and confirm:
- The Files tab shows `reference/ drafts/ published/ assets/` as expandable folders with friendly labels.
- Standard folders are open by default; clicking a folder toggles it.
- Selecting a file still shows content, the published badge, Delete, and (for `.md`) Publish.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/FileBrowser.tsx
git commit -m "feat(web): render files tab as a collapsible folder tree"
```

---

## Self-review notes

- **Spec coverage:** Part 1 → Task 1; Part 2 → Task 2; Part 3 (buildTree + FileTree + FileBrowser + tests) → Tasks 3–5. Out-of-scope items (hard enforcement, auto-move on publish, drag-drop) intentionally have no tasks.
- **Type consistency:** `buildTree` / `TreeNode` / `folderLabel` / `STANDARD_FOLDERS` defined in Task 3 are consumed with identical signatures in Tasks 4–5. `FileNode` is the existing type from `web/src/api.ts`.
- **No placeholders:** every code step shows full content.
