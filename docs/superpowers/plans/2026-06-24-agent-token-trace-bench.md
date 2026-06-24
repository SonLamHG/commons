# Agent Token Tracing + Real-Run Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture per-turn token usage from the drafting agent as NDJSON traces, and add a hand-run benchmark that drives the real agent and scores each run against four PASS criteria.

**Architecture:** A new `usage` AgentEvent is emitted per assistant message from the SDK's `message.usage`. A pure trace writer serializes events to NDJSON. The runner tees events into a writer when `COMMONS_TRACE_DIR` is set (Cách A). A benchmark script drives `createClaudeRunner` against a real `./data` workspace, scores runs via a pure `scoreRun` function, and cleans up created proposals via the engine.

**Tech Stack:** TypeScript (ESM, executed via `tsx`), `@anthropic-ai/claude-agent-sdk`, vitest, simple-git engine, Node `fs`.

## Global Constraints

- TypeScript `strict`; everything runs through `tsx` (no separate build for `src/`).
- ESM imports use the `.js` extension on relative paths (e.g. `./events.js`).
- MCP stdio must never write to stdout; logs go to stderr only. (Trace writer writes to FILES, not stdout — safe.)
- The agent toolset (`COMMONS_TOOLS`) and the human-gate invariant are unchanged. Cleanup in the benchmark uses the engine directly (operator tooling, not an agent over MCP) — this does NOT violate the human gate.
- Tests build a real engine over a `mkdtemp` dir and remove it in `afterEach`; no mocking of git. The benchmark harness itself is NOT added to `vitest` (it spends real API money).
- Default agent prompt for the benchmark: `Viết một bài LinkedIn ngắn giới thiệu tính năng review UI mới của Commons.`

---

### Task 1: Add the `usage` AgentEvent and map it in events.ts

**Files:**
- Modify: `src/agent/types.ts:1-5` (extend `AgentEvent` union)
- Modify: `src/agent/events.ts:23-33` (emit usage from assistant messages)
- Test: `test/agent-events.test.ts`

**Interfaces:**
- Produces: `AgentEvent` gains `{ type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }` (no `turn` field — the trace writer numbers turns). `toAgentEvent(msg)` emits one `usage` event per assistant message that carries `message.usage`, in addition to the existing `text`/`tool` events.

- [ ] **Step 1: Write the failing test**

Add to `test/agent-events.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toAgentEvent } from '../src/agent/events.js';

describe('toAgentEvent usage mapping', () => {
  it('emits a usage event from an assistant message usage block', () => {
    const msg = {
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'hi' }],
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 10,
        },
      },
    };
    const events = toAgentEvent(msg as any);
    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toEqual({
      type: 'usage',
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
      cacheCreationTokens: 10,
    });
    // text event still present
    expect(events.some((e) => e.type === 'text')).toBe(true);
  });

  it('emits no usage event when the assistant message has no usage', () => {
    const msg = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };
    const events = toAgentEvent(msg as any);
    expect(events.some((e) => e.type === 'usage')).toBe(false);
  });

  it('defaults missing usage sub-fields to 0', () => {
    const msg = { type: 'assistant', message: { content: [], usage: { input_tokens: 5 } } };
    const usage = toAgentEvent(msg as any).find((e) => e.type === 'usage');
    expect(usage).toEqual({
      type: 'usage',
      inputTokens: 5,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-events.test.ts -t "usage"`
Expected: FAIL — no usage events emitted (current `events.ts` ignores `usage`).

- [ ] **Step 3: Extend the AgentEvent union**

In `src/agent/types.ts`, change the union to add the usage variant:

```ts
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input?: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
  | { type: 'done'; result: string; costUsd: number; numTurns: number }
  | { type: 'error'; message: string };
```

- [ ] **Step 4: Emit usage in events.ts**

In `src/agent/events.ts`, update the `AssistantMessage` type and the assistant branch:

```ts
type AssistantMessage = {
  type: 'assistant';
  message?: {
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
};
```

In the `if (msg.type === 'assistant')` block, after the `for (const c of content)` loop and before `return out;`, add:

```ts
    const u = m.message?.usage;
    if (u) {
      out.push({
        type: 'usage',
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
      });
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/agent-events.test.ts`
Expected: PASS (all usage tests + existing event tests).

- [ ] **Step 6: Commit**

```bash
git add src/agent/types.ts src/agent/events.ts test/agent-events.test.ts
git commit -m "feat(agent): emit per-turn usage events from SDK assistant messages"
```

---

### Task 2: Trace writer (NDJSON, per-turn + summary)

**Files:**
- Create: `src/agent/trace.ts`
- Test: `test/agent-trace.test.ts`

**Interfaces:**
- Consumes: `AgentEvent` from `./types.js`.
- Produces:
  ```ts
  export interface TraceWriter { record(e: AgentEvent): void; close(): void }
  export function createTraceWriter(
    dir: string,
    runId: string,
    meta: { workspace: string; model: string },
  ): TraceWriter
  ```
  Writes to `<dir>/<workspace>-<runId>.ndjson`. Each `usage` event -> one `{ kind: 'turn', turn, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, ts }` line (turn starts at 1, increments per usage event). A `done` event -> one `{ kind: 'summary', workspace, model, numTurns, costUsd, totalInputTokens, totalOutputTokens, totalCacheReadTokens, totalCacheCreationTokens, ts }` line. `ts` is `new Date().toISOString()`. `text`/`tool`/`error` events are ignored by the writer.

- [ ] **Step 1: Write the failing test**

Create `test/agent-trace.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTraceWriter } from '../src/agent/trace.js';
import type { AgentEvent } from '../src/agent/types.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'commons-trace-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const usage = (i: number): AgentEvent => ({
  type: 'usage', inputTokens: i, outputTokens: 1, cacheReadTokens: 2, cacheCreationTokens: 3,
});

describe('createTraceWriter', () => {
  it('writes one numbered turn line per usage event and a summary on done', () => {
    const w = createTraceWriter(dir, 'run1', { workspace: 'ws1', model: 'claude-haiku-4-5' });
    w.record(usage(100));
    w.record(usage(200));
    w.record({ type: 'done', result: 'ok', costUsd: 0.05, numTurns: 2 });
    w.close();

    const file = join(dir, 'ws1-run1.ndjson');
    const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

    const turns = lines.filter((l) => l.kind === 'turn');
    expect(turns).toHaveLength(2);
    expect(turns[0].turn).toBe(1);
    expect(turns[0].inputTokens).toBe(100);
    expect(turns[1].turn).toBe(2);

    const summary = lines.find((l) => l.kind === 'summary');
    expect(summary.workspace).toBe('ws1');
    expect(summary.model).toBe('claude-haiku-4-5');
    expect(summary.numTurns).toBe(2);
    expect(summary.costUsd).toBe(0.05);
    expect(summary.totalInputTokens).toBe(300);
    expect(summary.totalOutputTokens).toBe(2);
    expect(summary.totalCacheReadTokens).toBe(4);
    expect(summary.totalCacheCreationTokens).toBe(6);
  });

  it('ignores text and tool events', () => {
    const w = createTraceWriter(dir, 'run2', { workspace: 'ws1', model: 'm' });
    w.record({ type: 'text', text: 'hello' });
    w.record({ type: 'tool', name: 'mcp__commons__overview' });
    w.close();
    const file = readdirSync(dir).find((f) => f.startsWith('ws1-run2'))!;
    const content = readFileSync(join(dir, file), 'utf8').trim();
    expect(content).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-trace.test.ts`
Expected: FAIL — `src/agent/trace.js` does not exist.

- [ ] **Step 3: Implement the trace writer**

Create `src/agent/trace.ts`:

```ts
import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { AgentEvent } from './types.js';

export interface TraceWriter {
  record(e: AgentEvent): void;
  close(): void;
}

export function createTraceWriter(
  dir: string,
  runId: string,
  meta: { workspace: string; model: string },
): TraceWriter {
  mkdirSync(dir, { recursive: true });
  const stream: WriteStream = createWriteStream(join(dir, `${meta.workspace}-${runId}.ndjson`));
  let turn = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;

  const writeLine = (obj: unknown) => stream.write(JSON.stringify(obj) + '\n');

  return {
    record(e: AgentEvent) {
      if (e.type === 'usage') {
        turn += 1;
        totalInputTokens += e.inputTokens;
        totalOutputTokens += e.outputTokens;
        totalCacheReadTokens += e.cacheReadTokens;
        totalCacheCreationTokens += e.cacheCreationTokens;
        writeLine({
          kind: 'turn',
          turn,
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
          cacheReadTokens: e.cacheReadTokens,
          cacheCreationTokens: e.cacheCreationTokens,
          ts: new Date().toISOString(),
        });
      } else if (e.type === 'done') {
        writeLine({
          kind: 'summary',
          workspace: meta.workspace,
          model: meta.model,
          numTurns: e.numTurns,
          costUsd: e.costUsd,
          totalInputTokens,
          totalOutputTokens,
          totalCacheReadTokens,
          totalCacheCreationTokens,
          ts: new Date().toISOString(),
        });
      }
    },
    close() {
      stream.end();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agent-trace.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/trace.ts test/agent-trace.test.ts
git commit -m "feat(agent): NDJSON trace writer for per-turn token usage"
```

---

### Task 3: Wire tracing into the runner (env-gated, Cách A)

**Files:**
- Modify: `src/agent/runner.ts`
- Test: `test/agent-trace.test.ts` (add a unit test for the env helper)

**Interfaces:**
- Consumes: `createTraceWriter` from `./trace.js`, `MODEL` value is not exported — instead read the model from `buildAgentOptions(...).model`.
- Produces: `export function traceDirFromEnv(env: NodeJS.ProcessEnv): string | undefined` returns `env.COMMONS_TRACE_DIR` (trimmed) or `undefined`. `createClaudeRunner()` unchanged in signature; when `traceDirFromEnv` is set it creates a writer per run (runId = `Date.now()` + 4 random hex chars), records every event, and closes on completion.

- [ ] **Step 1: Write the failing test for the env helper**

Add to `test/agent-trace.test.ts`:

```ts
import { traceDirFromEnv } from '../src/agent/runner.js';

describe('traceDirFromEnv', () => {
  it('returns the dir when COMMONS_TRACE_DIR is set', () => {
    expect(traceDirFromEnv({ COMMONS_TRACE_DIR: 'data/traces' } as any)).toBe('data/traces');
  });
  it('returns undefined when unset or blank', () => {
    expect(traceDirFromEnv({} as any)).toBeUndefined();
    expect(traceDirFromEnv({ COMMONS_TRACE_DIR: '  ' } as any)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agent-trace.test.ts -t "traceDirFromEnv"`
Expected: FAIL — `traceDirFromEnv` is not exported from runner.

- [ ] **Step 3: Implement the env helper and tee logic in runner.ts**

Replace the contents of `src/agent/runner.ts` with:

```ts
import { randomBytes } from 'node:crypto';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner, AgentEvent } from './types.js';
import { buildAgentOptions, framePrompt } from './options.js';
import { toAgentEvent } from './events.js';
import { createTraceWriter } from './trace.js';

export function traceDirFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const dir = env.COMMONS_TRACE_DIR?.trim();
  return dir ? dir : undefined;
}

/** A runner backed by the Claude Code harness (Agent SDK). The agent's MCP child
 *  is rooted at the caller-supplied tenant storage root, isolating tenants. */
export function createClaudeRunner(): AgentRunner {
  return {
    async run(tenantRoot, workspace, prompt, onEvent) {
      let costUsd = 0;
      let numTurns = 0;
      let ok = false;
      const options = buildAgentOptions(tenantRoot);
      const traceDir = traceDirFromEnv(process.env);
      const runId = `${Date.now()}-${randomBytes(2).toString('hex')}`;
      const trace = traceDir
        ? createTraceWriter(traceDir, runId, { workspace, model: String(options.model) })
        : undefined;
      const emit = (e: AgentEvent) => {
        trace?.record(e);
        onEvent(e);
      };
      try {
        for await (const msg of query({ prompt: framePrompt(workspace, prompt), options })) {
          for (const e of toAgentEvent(msg)) {
            if (e.type === 'done') { ok = true; costUsd = e.costUsd; numTurns = e.numTurns; }
            emit(e);
          }
        }
      } finally {
        trace?.close();
      }
      return { ok, costUsd, numTurns };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/agent-trace.test.ts test/agent-options.test.ts`
Expected: PASS (env helper tests + existing options tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/runner.ts test/agent-trace.test.ts
git commit -m "feat(agent): tee agent events into NDJSON trace when COMMONS_TRACE_DIR set"
```

---

### Task 4: Pure run-scoring function

**Files:**
- Create: `src/bench/score.ts`
- Test: `test/bench-score.test.ts`

**Interfaces:**
- Consumes: `AgentEvent` from `../agent/types.js`; `COMMONS_TOOLS` from `../agent/options.js`; `FileDiff` from `../engine/types.js`.
- Produces:
  ```ts
  export interface RunScore {
    proposal: boolean;       // a new submitted proposal with a drafts/ file exists
    firstCall: boolean;      // first tool event is mcp__commons__overview
    noStrayTools: boolean;   // every tool event name is in COMMONS_TOOLS
    rightWorkspace: boolean; // every tool input.workspace equals ws
    pass: boolean;           // all four true
  }
  export function scoreRun(input: {
    workspace: string;
    events: AgentEvent[];
    newProposals: Array<{ status: string; diffs: FileDiff[] }>;
  }): RunScore
  ```

- [ ] **Step 1: Write the failing test**

Create `test/bench-score.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scoreRun } from '../src/bench/score.js';
import type { AgentEvent } from '../src/agent/types.js';
import type { FileDiff } from '../src/engine/types.js';

const tool = (name: string, workspace?: string): AgentEvent => ({
  type: 'tool', name, input: workspace ? { workspace } : {},
});
const draftDiff: FileDiff[] = [{ path: 'drafts/post.md', status: 'added', diff: '+x' }];

describe('scoreRun', () => {
  it('passes when all four criteria hold', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [
        tool('mcp__commons__overview', 'ws1'),
        tool('mcp__commons__create_proposal', 'ws1'),
      ],
      newProposals: [{ status: 'submitted', diffs: draftDiff }],
    });
    expect(s).toEqual({ proposal: true, firstCall: true, noStrayTools: true, rightWorkspace: true, pass: true });
  });

  it('fails proposal when no submitted proposal with a drafts/ file', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [tool('mcp__commons__overview', 'ws1')],
      newProposals: [{ status: 'open', diffs: draftDiff }],
    });
    expect(s.proposal).toBe(false);
    expect(s.pass).toBe(false);
  });

  it('fails firstCall when first tool is not overview', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [tool('mcp__commons__read_state', 'ws1')],
      newProposals: [{ status: 'submitted', diffs: draftDiff }],
    });
    expect(s.firstCall).toBe(false);
  });

  it('fails noStrayTools on a tool outside COMMONS_TOOLS', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [tool('mcp__commons__overview', 'ws1'), tool('mcp__commons__list_workspaces', 'ws1')],
      newProposals: [{ status: 'submitted', diffs: draftDiff }],
    });
    expect(s.noStrayTools).toBe(false);
  });

  it('fails rightWorkspace on a wrong workspace id', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [tool('mcp__commons__overview', 'ws1'), tool('mcp__commons__read_state', 'other')],
      newProposals: [{ status: 'submitted', diffs: draftDiff }],
    });
    expect(s.rightWorkspace).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/bench-score.test.ts`
Expected: FAIL — `src/bench/score.js` does not exist.

- [ ] **Step 3: Implement scoreRun**

Create `src/bench/score.ts`:

```ts
import type { AgentEvent } from '../agent/types.js';
import type { FileDiff } from '../engine/types.js';
import { COMMONS_TOOLS } from '../agent/options.js';

export interface RunScore {
  proposal: boolean;
  firstCall: boolean;
  noStrayTools: boolean;
  rightWorkspace: boolean;
  pass: boolean;
}

export function scoreRun(input: {
  workspace: string;
  events: AgentEvent[];
  newProposals: Array<{ status: string; diffs: FileDiff[] }>;
}): RunScore {
  const toolEvents = input.events.filter((e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool');
  const allowed = new Set(COMMONS_TOOLS);

  const proposal = input.newProposals.some(
    (p) => p.status === 'submitted' && p.diffs.some((d) => d.path.startsWith('drafts/')),
  );
  const firstCall = toolEvents[0]?.name === 'mcp__commons__overview';
  const noStrayTools = toolEvents.every((t) => allowed.has(t.name));
  const rightWorkspace = toolEvents.every((t) => {
    const ws = (t.input as { workspace?: string } | undefined)?.workspace;
    return ws === undefined || ws === input.workspace;
  });

  return {
    proposal,
    firstCall,
    noStrayTools,
    rightWorkspace,
    pass: proposal && firstCall && noStrayTools && rightWorkspace,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/bench-score.test.ts`
Expected: PASS (all five tests).

- [ ] **Step 5: Commit**

```bash
git add src/bench/score.ts test/bench-score.test.ts
git commit -m "feat(bench): pure scoreRun for the four agent benchmark criteria"
```

---

### Task 5: Benchmark CLI harness + npm script

**Files:**
- Create: `src/bench/agent-bench.ts`
- Modify: `package.json` (add `bench:agent` script)

**Interfaces:**
- Consumes: `createEngine` from `../engine/index.js`; `createClaudeRunner` from `../agent/runner.js`; `scoreRun`, `RunScore` from `./score.js`; `AgentEvent` from `../agent/types.js`.
- Produces: a hand-run CLI. No exported API; not unit-tested (real API spend).

- [ ] **Step 1: Implement the harness**

Create `src/bench/agent-bench.ts`:

```ts
/**
 * Real-run benchmark for the Commons drafting agent. Drives the actual agent
 * (real Anthropic API) against an existing workspace under COMMONS_ROOT (./data),
 * scores each run, writes per-turn NDJSON traces, and cleans up created proposals.
 *
 * Usage:
 *   npm run bench:agent -- --workspace content-calendar --runs 10
 *   npm run bench:agent -- --workspace content-calendar --runs 3 --keep
 *   npm run bench:agent -- --workspace content-calendar --prompt "..."
 */
import { join } from 'node:path';
import { createEngine } from '../engine/index.js';
import { createClaudeRunner } from '../agent/runner.js';
import { scoreRun, type RunScore } from './score.js';
import type { AgentEvent } from '../agent/types.js';

const DEFAULT_PROMPT = 'Viết một bài LinkedIn ngắn giới thiệu tính năng review UI mới của Commons.';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const workspace = arg('workspace');
  if (!workspace) { console.error('error: --workspace <id> is required'); process.exit(1); }
  const runs = Number(arg('runs', '10'));
  const prompt = arg('prompt', DEFAULT_PROMPT)!;
  const keep = hasFlag('keep');

  const root = process.env.COMMONS_ROOT ?? join(process.cwd(), 'data');
  // Token traces for this benchmark land here (read by createClaudeRunner via env).
  process.env.COMMONS_TRACE_DIR = join(root, 'traces', 'bench');

  const engine = createEngine(root);
  const runner = createClaudeRunner();
  const results: Array<{ score: RunScore; numTurns: number; costUsd: number }> = [];

  for (let i = 1; i <= runs; i++) {
    const before = new Set((await engine.listProposals(workspace)).map((p) => p.id));
    const events: AgentEvent[] = [];
    const res = await runner.run(root, workspace, prompt, (e) => events.push(e));

    const fresh = (await engine.listProposals(workspace)).filter((p) => !before.has(p.id));
    const newProposals = await Promise.all(
      fresh.map(async (p) => ({ status: p.status, diffs: await engine.diffProposal(workspace, p.id) })),
    );
    const score = scoreRun({ workspace, events, newProposals });
    results.push({ score, numTurns: res.numTurns, costUsd: res.costUsd });

    const flags = [
      score.proposal ? 'P' : '·',
      score.firstCall ? 'F' : '·',
      score.noStrayTools ? 'S' : '·',
      score.rightWorkspace ? 'W' : '·',
    ].join('');
    console.log(
      `run ${String(i).padStart(2)}: ${score.pass ? 'PASS' : 'FAIL'} [${flags}] ` +
      `turns=${res.numTurns} cost=$${res.costUsd.toFixed(4)}`,
    );

    if (!keep) {
      for (const p of fresh) {
        try { await engine.discardProposal(workspace, p.id); }
        catch (e) { console.error(`  cleanup failed for ${p.id}: ${e instanceof Error ? e.message : e}`); }
      }
    }
  }

  const n = results.length;
  const rate = (sel: (s: RunScore) => boolean) =>
    `${results.filter((r) => sel(r.score)).length}/${n}`;
  const costs = results.map((r) => r.costUsd);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  console.log('\n── aggregate ──');
  console.log(`pass:            ${rate((s) => s.pass)}`);
  console.log(`proposal:        ${rate((s) => s.proposal)}`);
  console.log(`firstCall:       ${rate((s) => s.firstCall)}`);
  console.log(`noStrayTools:    ${rate((s) => s.noStrayTools)}`);
  console.log(`rightWorkspace:  ${rate((s) => s.rightWorkspace)}`);
  console.log(`mean cost/run:   $${(totalCost / n).toFixed(4)}`);
  console.log(`total spend:     $${totalCost.toFixed(4)}`);
  console.log(`traces:          ${process.env.COMMONS_TRACE_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add the npm script**

In `package.json`, in the `scripts` block, add:

```json
    "bench:agent": "tsx src/bench/agent-bench.ts",
```

- [ ] **Step 3: Smoke-run (n=1, hand-run, costs real money)**

Ensure a workspace exists (`npm run seed` creates `content-calendar`) and `ANTHROPIC_API_KEY` is set, then:

Run: `npm run bench:agent -- --workspace content-calendar --runs 1`
Expected: one `run  1: PASS/FAIL [....]` line, an aggregate block, and a trace file under `data/traces/bench/`. Confirm the trace file has `kind:"turn"` lines and one `kind:"summary"` line (this verifies the SDK actually attaches per-turn `usage`).

- [ ] **Step 4: Commit**

```bash
git add src/bench/agent-bench.ts package.json
git commit -m "feat(bench): real-run agent benchmark CLI with cleanup and aggregate report"
```

---

### Task 6: Document the benchmark in CLAUDE.md commands

**Files:**
- Modify: `CLAUDE.md` (Commands section)

- [ ] **Step 1: Add the command doc**

In `CLAUDE.md`, under the ```bash commands block, after the `npm run agent-sim` line, add:

```bash
npm run bench:agent -- --workspace content-calendar --runs 10   # real-run agent benchmark (spends API $); writes NDJSON token traces to data/traces/bench
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document bench:agent command"
```

---

## Self-Review

**Spec coverage:**
- Per-turn usage capture (spec §1) → Task 1.
- Trace writer NDJSON (spec §2) → Task 2.
- Runner wiring Cách A, env-gated (spec §3) → Task 3.
- Benchmark harness, 4 criteria, cleanup, aggregate output (spec §4) → Tasks 4 (scoring) + 5 (orchestration).
- Tests for events + trace (spec §5) → Tasks 1, 2; plus scoring tests in Task 4. Harness not in vitest → honored (Task 5 hand-run).
- Default prompt verbatim → Task 5 `DEFAULT_PROMPT` + Global Constraints.

**Placeholder scan:** No TBD/TODO; all code blocks are complete; no "add error handling" hand-waves (cleanup catch is concrete).

**Type consistency:** `AgentEvent` usage variant fields (`inputTokens`/`outputTokens`/`cacheReadTokens`/`cacheCreationTokens`) match across Tasks 1→2→3. `RunScore` fields match across Task 4 definition and Task 5 usage. `createTraceWriter(dir, runId, {workspace, model})` signature matches Task 2 definition and Task 3 call site. `scoreRun` input shape (`{workspace, events, newProposals:[{status, diffs}]}`) matches Task 4 and Task 5.

**Note on Task 3 coverage:** the SDK loop tee cannot be unit-tested without real API; the `traceDirFromEnv` helper is unit-tested and the actual per-turn capture is verified by the Task 5 Step 3 smoke-run (confirming the trace file content).
