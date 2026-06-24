# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Commons is a git-backed workspace where AI agents **propose** changes to knowledge-work
projects and a human **approves** them. The defining invariant: **agents can never merge.**
They read state and open/submit proposals over MCP; only a human merges (via the HTTP API,
and soon the web review UI).

Vocabulary that maps directly onto git:
- **Workspace** = a git repo; branch `main` is the durable, approved state.
- **Proposal** = a git worktree on a `proposal/<id>` branch. Agent writes land here, never
  touching `main` until a human merges.
- **Sync gate** = merge. Human-only by design.

## Commands

```bash
npm test                 # vitest run (all tests, 20s timeout)
npm run test:watch       # vitest watch mode
npx vitest run test/engine.test.ts          # single file
npx vitest run -t "creates a workspace"     # single test by name

npm run dev              # API (8787) + Vite web (5173) together via concurrently
npm run api              # API server only, tsx watch, serves built web/dist if present
npm run web              # Vite dev server only (proxies /api -> :8787)
npm run build:web        # build web/ to web/dist

npm run mcp              # stdio MCP server (for Claude Code/Desktop)
npm run mcp:http         # stateless streamable-HTTP MCP server (8765)

npm run seed             # create the 'content-calendar' demo workspace under ./data
npm run demo             # run the full lifecycle on real files + git
npm run agent-sim        # simulate an agent driving the engine
npm run bench:agent -- --workspace content-calendar --runs 10   # real-run agent benchmark (spends API $); writes NDJSON token traces to data/traces/bench
```

There is no separate build/lint step for `src/` — everything runs through `tsx` (ESM,
TypeScript executed directly). `tsconfig.json` is `strict`.

## Architecture

Three subsystems share one storage engine. They are intended to run as **separate OS
processes** against a common `COMMONS_ROOT`.

```
src/engine/   git-backed storage (simple-git). The only thing that touches disk/git.
src/mcp/      agent-facing MCP server (tools.ts) — NO merge/discard tools exist.
src/api/      human-facing Fastify HTTP API — has approve (merge) / reject (discard).
src/util/     serializer (per-workspace mutex), id generator.
web/          React 19 + Vite SPA review UI; talks to src/api over /api.
```

### Storage layout (under `COMMONS_ROOT`, default `./data`)
```
repos/<ws>/         the workspace git repo; HEAD = main = approved state
worktrees/<ws>/<id> a proposal's isolated worktree (proposal/<id> branch)
meta/<ws>/proposals.json   sidecar tracking proposal id/title/status/createdAt
```
Proposal status lives in the JSON sidecar, **separate from git** — this is the source of
drift risk (see Known limitations).

### The engine (`src/engine/index.ts`)
`createEngine(rootDir)` returns the `Engine` interface (`src/engine/types.ts`). It is the
sole disk/git authority. Key invariants baked in here:
- Branches are created off `main`; `main` only changes inside `mergeProposal`.
- `mergeProposal` uses `--no-ff`, detects conflicts **locale-independently** via
  `git diff --diff-filter=U` (not stdout parsing), and aborts cleanly on conflict leaving
  `main` untouched. It guards `status === 'submitted'`.
- All caller-supplied ids pass `assertSafeId` (`[A-Za-z0-9_-]+`); all relative paths pass
  `safeJoin` (blocks path traversal).
- **The engine is single-writer and NOT concurrency-safe.** Callers must serialize mutating
  ops per workspace.

### The serializer (`src/util/serializer.ts`)
`WorkspaceSerializer.run(workspaceId, fn)` chains mutating ops per workspace so they never
overlap. **Every mutating engine call goes through it** in both the MCP tools and the API.
Reads can be concurrent. One serializer instance per process; cross-process safety relies on
git's own file locking (which is why subsystems run as separate processes).

### MCP layer (`src/mcp/`)
`buildServer(engine)` registers the tools from `tools.ts`. The agent-facing toolset is
deliberately limited: `read_state`, `read_file`, `list_proposals`, `create_proposal`,
`write_proposal_file`, `submit_proposal`, `diff_proposal`. **Do not add a merge or discard
tool** — that would break the core human-gate invariant. Two transports wrap the same
server: `stdio.ts` (for Claude clients) and `http.ts` (stateless, fresh server per request).

### API layer (`src/api/`)
`buildApi(engine, serializer)` is the Fastify app (testable in isolation via `app.inject`).
`main.ts` wires it to a real engine and serves the built SPA. Merge/discard live ONLY here as
`POST .../approve` and `POST .../reject`.

## Critical conventions & gotchas

- **MCP stdio: never write to stdout.** It is the JSON-RPC channel — any `console.log`
  corrupts it. Log to stderr only (`process.stderr.write`).
- **API 404s for `/api/*` must be JSON, not the SPA shell.** `main.ts` has a custom
  not-found handler; the SPA fallback only applies to non-`/api` routes, or the client's
  JSON parsing breaks.
- **Windows + Git paths:** the engine normalizes worktree paths to forward slashes (`fwd()`)
  before passing them to `git.raw()`. Keep this when touching worktree commands.
- `COMMONS_ROOT` selects the storage root for every entry point (default `./data`, which is
  gitignored). `PORT` (API, 8787) and `MCP_HTTP_PORT` (8765) override ports.
- Tests build a real engine over a `mkdtemp` dir and remove it in `afterEach` — no mocking of
  git. Match this pattern for engine/API tests.

## Known limitations (read `KNOWN_LIMITATIONS.md` before extending)

- Sidecar (`proposals.json`) ↔ git state can drift if a merge/discard crashes mid-way; the
  three steps (worktree remove → branch -D → status update) are non-transactional with no
  repair path.
- Read paths (`readState`/`readFile`) throw raw `ENOENT` for unknown workspaces rather than a
  clean "not found".
- If you ever embed the MCP server and the web/API in the **same** process against one
  `COMMONS_ROOT`, they must share a **single** `WorkspaceSerializer`, or their mutations race.
