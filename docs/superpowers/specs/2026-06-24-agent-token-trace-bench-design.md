# Agent token tracing + real-run benchmark — design

Date: 2026-06-24
Status: approved (brainstorming)

## Problem

The Commons drafting agent (`src/agent`) runs on `claude-haiku-4-5` over a multi-turn
agent loop. We just landed three token-trimming changes (read_file slicing, stable cache
prefix, leaner toolset — branch `feat/agent-token-trim`). We need to **measure** their
effect with real runs, not estimates, and we need ongoing visibility into token usage.

Two gaps today:
- The SDK `result` message carries `usage`, but `events.ts` drops it — keeping only
  `total_cost_usd` and `num_turns`. We have no per-turn token data.
- There is no benchmark harness. Memory `agent-haiku-tool-naming` warns haiku tool-use is
  stochastic and that the dangerous regression ("agent runs but creates no proposal") still
  reports `ok:true`, so it must be verified with n>=10 real runs, not n=1.

## Goals

1. **Per-turn token trace**, written as NDJSON, usable both by the benchmark and in prod.
2. **A real-run benchmark harness** that drives the actual agent (real Anthropic API) and
   scores each run against pass/fail criteria, reporting pass-rate and token/cost stats.

Non-goals: per-tool token attribution (SDK does not split tokens per tool); a UI for traces;
running the benchmark inside `vitest` (it costs money — it stays a hand-run script).

## Design

### 1. Capture token usage per turn — `src/agent/events.ts`, `src/agent/types.ts`

Add a new event to `AgentEvent`:

```ts
| { type: 'usage'; turn: number; inputTokens: number; outputTokens: number;
    cacheReadTokens: number; cacheCreationTokens: number }
```

`toAgentEvent` gains a turn counter (per call site it is stateless, so the counter lives in
the runner and is passed in, OR events.ts emits usage without a turn index and the trace
writer numbers them). Decision: **the trace writer assigns the turn index** by counting
usage events in order — keeps `toAgentEvent` pure.

For each `assistant` message, read `message.usage` defensively:
`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
(any missing field defaults to 0). If `usage` is absent entirely, emit no usage event.
The existing `text` / `tool` events for that message are still emitted.

`done` is unchanged (cost + numTurns from the `result` message).

### 2. Trace writer — `src/agent/trace.ts`

```ts
createTraceWriter(dir: string, runId: string, meta: { workspace: string; model: string })
  => { record(e: AgentEvent): void; close(): void }
```

- Ensures `dir` exists, opens `dir/<workspace>-<runId>.ndjson`.
- On each `usage` event: writes one line
  `{ kind: 'turn', turn, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, ts }`,
  incrementing an internal turn counter, and accumulates running totals.
- On `done`: writes a final `{ kind: 'summary', workspace, model, numTurns, costUsd,
  totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheCreationTokens, ts }`.
- `close()` flushes and closes the stream.

The writer is pure I/O over the event stream — no engine or SDK dependency, unit-testable by
feeding it a hand-built event array.

### 3. Wire tracing into the runner (Cách A) — `src/agent/runner.ts`

`createClaudeRunner` reads `process.env.COMMONS_TRACE_DIR`. If set, for each run it creates a
trace writer (runId = timestamp + short random) and tees every event into it before calling
the caller's `onEvent`; closes the writer when the run ends. If unset, behavior is exactly as
today. This gives both the benchmark and production tracing via one env var, with the
`AgentRunner` interface unchanged.

### 4. Benchmark harness — `src/bench/agent-bench.ts`, npm script `bench:agent`

CLI args:
- `--workspace <ws>` (required) — an existing workspace under `COMMONS_ROOT` (default `./data`).
- `--runs <N>` (default 10).
- `--prompt "<text>"` (default: a realistic drafting prompt, see below).
- `--keep` — skip cleanup of proposals created during the benchmark.

Default prompt:
> "Viết một bài LinkedIn ngắn giới thiệu tính năng review UI mới của Commons."

Per run:
1. Snapshot existing proposal ids (`engine.listProposals`).
2. Run the real agent via `createClaudeRunner` (real API key required). Collect the event
   stream locally to score criteria; `COMMONS_TRACE_DIR` is pointed at `data/traces/bench`
   so token traces are written too.
3. Score the four PASS criteria:
   - **proposal**: a new proposal exists, is `submitted`, and its diff includes a file under
     `drafts/` (via `engine.listProposals` + `engine.diffProposal`).
   - **firstCall**: the first `tool` event name is `mcp__commons__overview`.
   - **noStrayTools**: every `tool` event name is in `COMMONS_TOOLS`.
   - **rightWorkspace**: every `tool` event whose input has a `workspace` field equals `ws`.
   A run PASSES only if all four hold.
4. **Cleanup** (unless `--keep`): the script (not the agent — this is allowed; the human-gate
   invariant applies to agents over MCP, not to operator tooling) discards every
   newly-created proposal via the engine (worktree remove -> branch -D -> sidecar update),
   leaving `./data` as it was.

Output:
- A per-run table: run #, pass/fail per criterion, numTurns, total input/output/cache tokens,
  costUsd.
- Aggregate: overall pass rate, per-criterion pass rate, mean/median total tokens, mean
  cost/run, total spend for the benchmark.
- Full per-turn NDJSON traces remain under `data/traces/bench/` for offline analysis.

### 5. Tests

- `test/agent-events.test.ts`: extend — an assistant message with `usage` yields a `usage`
  event with the mapped fields; one without `usage` yields none.
- `test/agent-trace.test.ts` (new): feeding a writer a sequence of usage events + a done
  event produces the expected NDJSON turn lines and summary line with correct totals.
- The harness itself is NOT added to `vitest` (real API cost). It is run by hand:
  `npm run bench:agent -- --workspace content-calendar --runs 10`.

## Risks / notes

- Per-turn `usage` depends on the SDK attaching `usage` to assistant messages. The mapping is
  defensive (missing -> 0, absent -> no event), so if the shape differs the trace degrades
  gracefully rather than crashing; verify against a real run early.
- Benchmark spends real money (~$0.03-0.08/run on haiku per earlier estimate; 10 runs ~ <$1).
- Recommended usage per memory `agent-haiku-tool-naming`: n=3 as a cheap smoke gate, then
  n>=10 before trusting reliability — haiku tool-use is stochastic.
- Cleanup uses the engine directly; if a discard step crashes mid-way the sidecar can drift
  (see `KNOWN_LIMITATIONS.md`). Acceptable for a dev benchmark; `--keep` avoids it entirely.
