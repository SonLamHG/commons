# Known Limitations — Commons Engine (Subsystem 1)

Status: engine complete, 15/15 tests pass. These are deliberately deferred items. **Read before building Subsystem 2 (MCP server) on top.**

## Must be handled by the caller (MCP layer)

### 1. Single-writer per workspace — NO concurrency control
The engine is **not** concurrency-safe. Two mutating operations racing on the same workspace will corrupt each other:
- Two `mergeProposal` calls both `checkout main` and manipulate the same git index.
- `readMeta`/`writeMeta` is a read-modify-write on `proposals.json` with last-writer-wins → proposal records can be silently dropped.

**Requirement for the MCP server:** serialize all mutating operations per workspace (a per-workspace mutex/queue). Reads can be concurrent; writes/merges/discards must not overlap for the same workspace.

### 1b. Serializer is per-instance — shared root needs a shared serializer (for Subsystem 3)
`WorkspaceSerializer` is created once per `buildServer()` call. The expected deployment keeps the MCP server (stdio child process) and the future web review UI (separate HTTP process) as **separate OS processes** — git's own file locking covers cross-process safety there. BUT if anyone embeds both in the **same Node process** against the same `COMMONS_ROOT`, all mutating operations — including the web UI's `mergeProposal`/`discardProposal` — must route through a **single shared `WorkspaceSerializer`** instance, or they will race with MCP-layer mutations.

## Deferred (document, fix later)

### 5. Built-in web agent: auth, cost, and concurrency
The web Assistant runs the Claude Agent SDK in-process. Caveats:
- **Auth/cost:** locally it rides the machine's Claude Code subscription login (≈0 marginal cost, weekly headless token pool from 2026-06-15). Production must set `ANTHROPIC_API_KEY` (pay-per-token). The `AgentRunner` boundary isolates this swap.
- **Concurrency:** each run spawns the commons **stdio** MCP as a separate process with its own serializer. Two agent runs (or an agent run + a web merge) on the *same workspace* at the *same time* rely on git's file locking only (see #1/#1b). Fine for single-user dogfooding; revisit for multi-user.
- **No mid-run cancel** and **no per-user token budget** yet.

### 2. Sidecar ↔ git state drift on crash
`mergeProposal` / `discardProposal` do `worktree remove → branch -D → updateProposal(status)` non-transactionally. A crash between steps leaves `proposals.json` inconsistent with git (e.g. status `submitted` but branch already gone). No reconciliation/repair path exists yet. Callers must not assume the sidecar is always consistent with git after an interrupted op.

### 3. No workspace-existence clean errors on read paths
`readState` / `readFile` on an unknown `workspaceId` throw raw `ENOENT` rather than a clean `workspace not found`. Callers currently can't rely on stable error messages for the read path (the mutating methods do throw clean messages).

### 4. Human direct writes (upload + delete) bypass the review gate (by design)
`addFile`/upload and `deleteFile`/`DELETE .../file` mutate `main` directly with **no review step**, symmetric with each other — the gate governs *agent* proposals, not the user's own actions on their workspace. Delete is irreversible from the UI (a `git rm` + commit; history still holds it, but there is no restore UI).

**Uploaded source material — additional caveats:**
`addFile` + the `POST /api/workspaces/:ws/files` upload write human-provided source material straight to `main` under `reference/` with **no review step**. This is intentional — the review gate governs *agent* proposals, not the user's own inputs. Two caveats follow:
- **Text-only:** PDF/DOCX are extracted to plain text (pdf-parse / mammoth). Images, tables, and rich formatting are lost; the stored `reference/<name>.md` is what the agent reads.
- **No de-dup / overwrite guard:** two uploads whose names sanitize to the same `reference/<base>.md` overwrite each other (last writer wins). Mutating uploads still route through the per-workspace serializer, so they won't corrupt git — but the older content is gone.

## Already addressed (for reference)
- Caller-supplied ids are validated (`assertSafeId`: `[A-Za-z0-9_-]+`) before use in branch names / fs paths.
- `safeJoin` guards path traversal in both seed writes, proposal writes, and `readFile`.
- Conflict detection is locale-independent (git state via `--diff-filter=U`, not stdout text); conflict aborts leave `main` clean.
- `mergeProposal` guards status (`submitted` only); `writeProposalFile` blocks merged/discarded proposals.
- Proposals branch explicitly off `main`.
