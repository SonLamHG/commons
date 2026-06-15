# Files tab — folder organization

Date: 2026-06-15
Status: Approved (design)

## Problem

The Files tab renders every file in a workspace as one flat list. `FileBrowser`
([web/src/components/FileBrowser.tsx](../../../web/src/components/FileBrowser.tsx))
calls `readState` then `filter((n) => n.type === 'file')`, discarding the directory
nodes the engine already returns. As a workspace accumulates files this becomes hard
for a human to manage and gives an agent no structural cue about where things belong.

Two layers cause this:

- **A — Display:** the UI shows no folder structure.
- **B — Convention:** there is no standard directory layout, so files land anywhere.

This design addresses both, role-based, without touching the engine's "agents can
never merge" invariant.

## Solution overview

A role-based standard directory layout (B), agents guided into it softly (no hard
enforcement), and a collapsible folder tree in the UI (A).

## Part 1 — Directory convention (backend)

Four standard top-level directories per workspace, organized by role in the content
lifecycle:

| Directory    | Role                                            | Primary writer        |
|--------------|-------------------------------------------------|-----------------------|
| `reference/` | Source material: briefs, brand voice, notes     | User upload           |
| `drafts/`    | Content the agent is drafting                   | Agent (via proposal)  |
| `published/` | Finalized / published versions                  | User/agent (optional) |
| `assets/`    | Images and supporting files                     | Either                |

Changes:

- **Seed** (`buildSeed` in [src/api/server.ts](../../../src/api/server.ts)) creates the
  four directories, each containing a short `README.md` describing its purpose. The
  README both keeps the directory in git (git does not track empty directories) and
  serves as an in-workspace map an agent can read.
- **Upload** keeps its existing `reference/` destination (`referencePath` in
  [src/upload/extract.ts](../../../src/upload/extract.ts)) — no change.
- **`published/`** is a location users/agents place files into manually. Pressing
  Publish does **not** move files; Publish stays a webhook action exactly as today.
  This keeps the publish flow out of scope.

## Part 2 — Soft guidance for agents

No hard blocking — guide the agent to place files correctly:

- **MCP tool description** for `write_proposal_file`
  ([src/mcp/tools.ts](../../../src/mcp/tools.ts)) gains a line: drafted content belongs
  in `drafts/`, read background from `reference/`, do not overwrite `reference/`.
- **Seed READMEs** (from Part 1) act as a workspace map; an agent calling `read_state`
  then `read_file` on the READMEs understands the layout.
- `read_state` / `read_file` are unchanged. The agent still sees the whole tree; it is
  now just structured.

This does not alter the human-merge-gate invariant.

## Part 3 — Folder tree UI (frontend)

Edit [web/src/components/FileBrowser.tsx](../../../web/src/components/FileBrowser.tsx):

- Remove `filter((n) => n.type === 'file')`; use both `dir` and `file` nodes that
  `readState` already returns.
- Build the tree client-side from the flat `path` list (split on `/`), rendered
  recursively: directories are collapsible, files are selectable buttons as today.
- Friendly labels for the four standard directories, e.g. `reference/` → "📎 Tư liệu
  nguồn", `drafts/` → "✍️ Bản nháp", `published/` → "✅ Đã xuất bản", `assets/` →
  "🖼️ Tài nguyên". Other directories show their real name.
- Preserve all existing behavior: select file → view content, `published` badge, Delete
  button, Publish button, upload bar, webhook bar.
- Standard directories are expanded by default; deeper nesting collapsed.
- Extract a small recursive `FileTree` component out of `FileBrowser`: `FileBrowser`
  owns data + the detail pane, `FileTree` owns tree rendering + selection.

### Testing

Add tests for the tree-building logic (pure, no git required):

- `["reference/a.md", "drafts/b.md"]` → correct nested structure.
- Empty input → empty tree.
- A file at the root (no directory) → handled.

## Out of scope

- Hard enforcement of paths at the engine/MCP layer.
- Auto-moving files between directories on Publish.
- Changing the publish/webhook flow.
- Drag-and-drop reorganization in the UI.
