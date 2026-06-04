# Commons

A versioned workspace where AI agents **propose** changes to knowledge-work projects and a human **approves** them — built on a git-backed engine. Agents (Claude, and later ChatGPT/Cursor) connect over MCP; they can read state and open/submit proposals, but **only a human can merge**.

Status: **Subsystem 1 (engine)** + **Subsystem 2 (MCP server)** complete. Subsystem 3 (web review UI) is next — until then, approving/merging is done via the engine API, not a GUI.

## Concepts
- **Workspace** = a git repo; branch `main` is the durable, approved state.
- **Proposal** = an isolated git worktree on a `proposal/<id>` branch. Agent writes land here, never touching `main` until merged.
- **Sync gate** = merge. Agents cannot merge; that's the human's call.

## Setup
```bash
npm install
npm test        # 26 tests
npm run demo    # watch the full lifecycle on real files + git
```

## Try it with a real Claude agent (stdio MCP)

1. **Seed a workspace** the server can see:
   ```bash
   npm run seed
   ```
   Creates workspace `content-calendar` under `./data` (the default `COMMONS_ROOT`).

2. **Point Claude Code / Claude Desktop at the server.** Add to your MCP config
   (`.mcp.json` for Claude Code, or the Claude Desktop config file). Use ABSOLUTE paths:
   ```json
   {
     "mcpServers": {
       "commons": {
         "command": "npx",
         "args": ["tsx", "D:/code/commons/src/mcp/stdio.ts"],
         "env": { "COMMONS_ROOT": "D:/code/commons/data" }
       }
     }
   }
   ```

3. **Ask Claude** (in a session where the `commons` MCP is enabled):
   > "In workspace `content-calendar`: read the brand voice, then draft a new post as a proposal and submit it for review."

   Expect Claude to call `read_state` → `read_file` → `create_proposal` → `write_proposal_file` → `submit_proposal`. It has **no merge tool** — confirm it cannot self-approve.

4. **Verify the proposal landed (and main is untouched):**
   ```bash
   cd data/repos/content-calendar
   git branch -a          # shows a proposal/p-... branch
   git worktree list      # shows the proposal's isolated worktree
   git log --oneline      # main has NOT changed
   ```
   The proposed draft lives on the proposal branch; `main` only changes when a human merges (`engine.mergeProposal(...)`, or the future review UI).

## MCP tools (agent-facing)
`read_state`, `read_file`, `list_proposals`, `create_proposal`, `write_proposal_file`, `submit_proposal`, `diff_proposal`. No `merge`/`discard` — human-only by design.

## Architecture & limits
- Engine: `src/engine/` (git via simple-git). MCP: `src/mcp/` (server + per-workspace serializer).
- The engine is single-writer per workspace; the MCP server serializes mutating calls. See `KNOWN_LIMITATIONS.md`.
