# Web Agent (scoped Claude harness) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user type a prompt in the web product and get a reviewable proposal back — driven by the real Claude Code harness (Agent SDK), but scoped to the project: it can ONLY use the commons MCP tools, nothing else.

**Architecture:** A new `AgentRunner` boundary wraps `@anthropic-ai/claude-agent-sdk`'s `query()`. The runner spawns the agent with the existing commons **stdio MCP** as its only tool source, a narrow system prompt, all built-in tools disallowed, and a modest model (Sonnet). A streaming API route (NDJSON over a Node Readable) relays agent events to a web chat panel. When the agent finishes it has created+submitted a proposal, which appears in the existing Proposals tab for human review. The MCP server stays untouched for power users who prefer their own harness.

**Tech Stack:** `@anthropic-ai/claude-agent-sdk` (the Claude Code harness as a library; auth rides the machine's existing Claude Code login), Node Readable streaming, Fastify, React, vitest. Reuses the existing engine, `src/mcp/stdio.ts`, and the F-05 reading view.

**Scope boundary (why this is safe):** `settingSources: []` means the agent loads none of the user's global Claude config or MCP servers. The only MCP server configured is `commons`. `allowedTools` lists exactly the 9 commons tools; `disallowedTools` denies every built-in (Bash/Edit/Write/Read/Web/…). So the agent's entire universe of actions = the 9 governed commons tools. It cannot touch the filesystem, run shell, or reach the network. It also cannot `merge`/`discard` (those were never exposed by the MCP — agent proposes, human disposes).

**Cost/auth note:** Local runs ride the machine's Claude Code subscription login (≈0 marginal cost, subject to the weekly headless token pool from 2026-06-15). Production would set `ANTHROPIC_API_KEY` (pay-per-token) — no code change, just env; the `AgentRunner` boundary keeps that swap isolated.

---

## File Structure

- Create: `src/agent/types.ts` — `AgentEvent`, `AgentResult`, `AgentRunner` interface.
- Create: `src/agent/options.ts` — `buildAgentOptions(root, workspace)` pure function → Agent SDK `Options`. Testable.
- Create: `src/agent/events.ts` — `toAgentEvent(msg)` pure mapping `SDKMessage` → `AgentEvent | null`. Testable.
- Create: `src/agent/runner.ts` — `createClaudeRunner(root)` returns an `AgentRunner` using `query()`.
- Modify: `src/api/server.ts` — `buildApi(...)` gains an injectable `agentRunner`; add `POST /api/workspaces/:ws/agent` streaming route.
- Modify: `src/api/main.ts` — construct the real runner and pass it to `buildApi`.
- Create: `test/agent-options.test.ts`, `test/agent-events.test.ts` — unit tests for the pure pieces.
- Modify: `test/api.test.ts` — add agent-route test with a **fake** runner (no LLM in CI).
- Create: `web/src/components/AgentChat.tsx` — chat panel.
- Modify: `web/src/api.ts` — `agentStream(ws, prompt, onEvent)` client.
- Modify: `web/src/App.tsx` — add an "Assistant" tab.
- Modify: `web/src/styles.css` — chat styles.
- Modify: `KNOWN_LIMITATIONS.md`, `README.md` — document the web agent + scope + cost.

---

## Task 1: Agent types + scoped options builder

**Files:**
- Create: `src/agent/types.ts`
- Create: `src/agent/options.ts`
- Test: `test/agent-options.test.ts`

- [ ] **Step 1: Install the SDK**

Run: `npm install @anthropic-ai/claude-agent-sdk`
Expected: `added N packages`, no errors.

- [ ] **Step 2: Write the types**

Create `src/agent/types.ts`:

```typescript
export type AgentEvent =
  | { type: 'text'; text: string }                       // assistant prose
  | { type: 'tool'; name: string; input?: unknown }      // a tool the agent invoked
  | { type: 'done'; result: string; costUsd: number; numTurns: number }
  | { type: 'error'; message: string };

export interface AgentResult {
  ok: boolean;
  costUsd: number;
  numTurns: number;
}

export interface AgentRunner {
  /** Run one prompt against a workspace, streaming events via onEvent.
   *  Resolves when the agent has finished (it will have submitted a proposal). */
  run(workspace: string, prompt: string, onEvent: (e: AgentEvent) => void): Promise<AgentResult>;
}
```

- [ ] **Step 3: Write the failing test**

Create `test/agent-options.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildAgentOptions, COMMONS_TOOLS } from '../src/agent/options.js';

describe('buildAgentOptions', () => {
  it('scopes the agent to commons tools only', () => {
    const o = buildAgentOptions('/data', 'ws1');
    // allow exactly the 9 commons tools, namespaced
    expect(o.allowedTools).toEqual(COMMONS_TOOLS);
    expect(o.allowedTools).toContain('mcp__commons__create_proposal');
    expect(o.allowedTools).toContain('mcp__commons__overview');
    // built-ins are denied
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch']));
    // never expose merge/discard (defence-in-depth: they aren't commons MCP tools anyway)
    expect(o.allowedTools).not.toContain('mcp__commons__merge_proposal');
  });

  it('loads no global settings and only the commons MCP server', () => {
    const o = buildAgentOptions('/data', 'ws1');
    expect(o.settingSources).toEqual([]);
    expect(Object.keys(o.mcpServers ?? {})).toEqual(['commons']);
    expect((o.mcpServers as any).commons.env.COMMONS_ROOT).toBe('/data');
  });

  it('uses a modest model and a workspace-scoped system prompt', () => {
    const o = buildAgentOptions('/data', 'march-campaign');
    expect(o.model).toMatch(/sonnet/);
    expect(typeof o.systemPrompt).toBe('string');
    expect(o.systemPrompt as string).toContain('march-campaign');
    expect(o.systemPrompt as string).toContain('proposal');
    expect(o.maxTurns).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run test/agent-options.test.ts`
Expected: FAIL — cannot find `../src/agent/options.js`.

- [ ] **Step 5: Implement the options builder**

Create `src/agent/options.ts`:

```typescript
import { resolve, join } from 'node:path';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

const SERVER = 'commons';

/** The exact agent-facing tools the MCP server exposes, namespaced as the
 *  Agent SDK sees them (mcp__<server>__<tool>). Mirrors src/mcp/tools.ts. */
export const COMMONS_TOOLS = [
  'overview',
  'list_workspaces',
  'read_state',
  'read_file',
  'list_proposals',
  'create_proposal',
  'write_proposal_file',
  'submit_proposal',
  'diff_proposal',
].map((t) => `mcp__${SERVER}__${t}`);

/** Built-in harness tools we forbid — the agent works ONLY through commons. */
const DENY_BUILTINS = [
  'Bash', 'Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit', 'NotebookRead',
  'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task',
  'KillShell', 'BashOutput', 'ExitPlanMode', 'SlashCommand',
];

const MODEL = process.env.COMMONS_AGENT_MODEL ?? 'claude-sonnet-4-6';

function systemPrompt(workspace: string): string {
  return [
    `You are the drafting assistant for the knowledge-work workspace "${workspace}".`,
    `Your ONLY job is to turn the user's request into a single reviewable proposal that a human will approve or reject. You do not publish and you cannot merge.`,
    ``,
    `Workflow, in order:`,
    `1. Call overview, then read_state / read_file, to understand the current content and any material under reference/.`,
    `2. create_proposal with a short, human-readable title.`,
    `3. write_proposal_file for each file you add or change (Markdown).`,
    `4. diff_proposal to check your own changes, then submit_proposal.`,
    ``,
    `Rules: use only the commons tools available to you. Keep deliverables in Markdown. If the request is ambiguous, make reasonable assumptions and state them at the top of the draft. Do not ask the user follow-up questions — produce the best proposal you can in one pass.`,
  ].join('\n');
}

/** Build a fully-scoped Agent SDK Options for one workspace. Pure/testable. */
export function buildAgentOptions(root: string, workspace: string): Options {
  const absRoot = resolve(root);
  const stdioPath = join(absRoot, '..', 'src', 'mcp', 'stdio.ts'); // see note below
  const isWin = process.platform === 'win32';
  return {
    model: MODEL,
    systemPrompt: systemPrompt(workspace),
    maxTurns: 24,
    permissionMode: 'default',
    settingSources: [],
    allowedTools: COMMONS_TOOLS,
    disallowedTools: DENY_BUILTINS,
    mcpServers: {
      [SERVER]: {
        type: 'stdio',
        command: isWin ? 'cmd' : 'npx',
        args: isWin ? ['/c', 'npx', 'tsx', commonsStdioPath()] : ['tsx', commonsStdioPath()],
        env: { COMMONS_ROOT: absRoot },
      },
    },
  };
}

/** Absolute path to the commons stdio MCP entry. Resolved from this module so it
 *  is correct regardless of the API process's cwd. */
export function commonsStdioPath(): string {
  // src/agent/options.ts -> src/mcp/stdio.ts
  return resolve(new URL('../mcp/stdio.ts', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
}
```

> Note: the `stdioPath` local in `buildAgentOptions` is unused once `commonsStdioPath()` exists — remove the local line; it is shown only to flag the resolution concern. Keep `commonsStdioPath()`.

- [ ] **Step 6: Remove the dead `stdioPath` local**

Delete this line from `buildAgentOptions`:

```typescript
    const stdioPath = join(absRoot, '..', 'src', 'mcp', 'stdio.ts'); // see note below
```

And drop the now-unused `join` import if nothing else uses it (it isn't — remove `join` from the import, keep `resolve`).

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run test/agent-options.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/agent/types.ts src/agent/options.ts test/agent-options.test.ts package.json package-lock.json
git commit -m "feat(agent): scoped Agent SDK options builder + types"
```

---

## Task 2: SDKMessage → AgentEvent mapping

**Files:**
- Create: `src/agent/events.ts`
- Test: `test/agent-events.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/agent-events.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { toAgentEvent } from '../src/agent/events.js';

describe('toAgentEvent', () => {
  it('maps assistant text content to a text event', () => {
    const msg: any = { type: 'assistant', message: { content: [{ type: 'text', text: 'Drafting…' }] } };
    expect(toAgentEvent(msg)).toEqual([{ type: 'text', text: 'Drafting…' }]);
  });

  it('maps assistant tool_use to a tool event', () => {
    const msg: any = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'mcp__commons__create_proposal', input: { title: 'x' } }] } };
    expect(toAgentEvent(msg)).toEqual([{ type: 'tool', name: 'mcp__commons__create_proposal', input: { title: 'x' } }]);
  });

  it('maps a successful result to a done event', () => {
    const msg: any = { type: 'result', subtype: 'success', result: 'Submitted proposal.', total_cost_usd: 0.01, num_turns: 5 };
    expect(toAgentEvent(msg)).toEqual([{ type: 'done', result: 'Submitted proposal.', costUsd: 0.01, numTurns: 5 }]);
  });

  it('maps an error result to an error event', () => {
    const msg: any = { type: 'result', subtype: 'error_max_turns', errors: ['too many turns'], total_cost_usd: 0.02, num_turns: 24 };
    expect(toAgentEvent(msg)).toEqual([{ type: 'error', message: 'too many turns' }]);
  });

  it('ignores noise (system/user/stream events)', () => {
    expect(toAgentEvent({ type: 'system', content: 'x' } as any)).toEqual([]);
    expect(toAgentEvent({ type: 'user', message: {} } as any)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/agent-events.test.ts`
Expected: FAIL — cannot find `../src/agent/events.js`.

- [ ] **Step 3: Implement the mapping**

Create `src/agent/events.ts`:

```typescript
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from './types.js';

/** Map one SDK message to zero or more AgentEvents the web cares about. */
export function toAgentEvent(msg: SDKMessage): AgentEvent[] {
  if (msg.type === 'assistant') {
    const out: AgentEvent[] = [];
    for (const c of (msg as any).message.content ?? []) {
      if (c.type === 'text' && c.text) out.push({ type: 'text', text: c.text });
      else if (c.type === 'tool_use') out.push({ type: 'tool', name: c.name, input: c.input });
    }
    return out;
  }
  if (msg.type === 'result') {
    const m = msg as any;
    if (m.subtype === 'success') {
      return [{ type: 'done', result: m.result ?? '', costUsd: m.total_cost_usd ?? 0, numTurns: m.num_turns ?? 0 }];
    }
    return [{ type: 'error', message: (m.errors ?? ['agent failed']).join('; ') }];
  }
  return [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/agent-events.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/events.ts test/agent-events.test.ts
git commit -m "feat(agent): map SDK messages to web agent events"
```

---

## Task 3: Claude runner (integration glue, no unit test)

**Files:**
- Create: `src/agent/runner.ts`

> This file calls the real `query()`; it is verified by the live smoke test in Task 6, not by CI (an LLM call is non-deterministic). Keep it thin: all testable logic already lives in `options.ts`/`events.ts`.

- [ ] **Step 1: Implement the runner**

Create `src/agent/runner.ts`:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, AgentResult, AgentRunner } from './types.js';
import { buildAgentOptions } from './options.js';
import { toAgentEvent } from './events.js';

/** A runner backed by the Claude Code harness (Agent SDK). Auth rides the
 *  machine's existing Claude Code login locally; set ANTHROPIC_API_KEY for prod. */
export function createClaudeRunner(root: string): AgentRunner {
  return {
    async run(workspace, prompt, onEvent) {
      let costUsd = 0;
      let numTurns = 0;
      let ok = false;
      for await (const msg of query({ prompt, options: buildAgentOptions(root, workspace) })) {
        for (const e of toAgentEvent(msg)) {
          if (e.type === 'done') { ok = true; costUsd = e.costUsd; numTurns = e.numTurns; }
          onEvent(e);
        }
      }
      return { ok, costUsd, numTurns };
    },
  };
}
```

- [ ] **Step 2: Type-check it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (if `tsc` is not wired, run `npx vitest run` — imports resolve).

- [ ] **Step 3: Commit**

```bash
git add src/agent/runner.ts
git commit -m "feat(agent): Claude harness runner behind AgentRunner boundary"
```

---

## Task 4: Streaming API route (tested with a fake runner)

**Files:**
- Modify: `src/api/server.ts`
- Modify: `src/api/main.ts`
- Test: `test/api.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `test/api.test.ts` inside the top-level `describe('API', ...)` block (after the existing file tests). It builds its own app with a **fake** runner so no LLM is called:

```typescript
  it('POST agent streams events and creates a proposal (fake runner)', async () => {
    const { createEngine } = await import('../src/engine/index.js');
    const { WorkspaceSerializer } = await import('../src/util/serializer.js');
    const { createPublishStore } = await import('../src/publish/store.js');
    const r = mkdtempSync(join(tmpdir(), 'commons-agent-'));
    const engine = createEngine(r);
    await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });

    const fakeRunner = {
      run: async (_ws: string, _prompt: string, onEvent: (e: any) => void) => {
        onEvent({ type: 'text', text: 'Drafting…' });
        onEvent({ type: 'tool', name: 'mcp__commons__create_proposal' });
        onEvent({ type: 'done', result: 'Submitted.', costUsd: 0.01, numTurns: 3 });
        return { ok: true, costUsd: 0.01, numTurns: 3 };
      },
    };
    const a = buildApi(engine, new WorkspaceSerializer(), createPublishStore(r), fakeRunner);

    const res = await a.inject({
      method: 'POST', url: '/api/workspaces/ws1/agent',
      payload: { prompt: 'write a post' }, headers: { 'content-type': 'application/json' },
    });
    expect(res.statusCode).toBe(200);
    const events = res.payload.trim().split('\n').map((l) => JSON.parse(l));
    expect(events[0]).toEqual({ type: 'text', text: 'Drafting…' });
    expect(events.find((e: any) => e.type === 'done')).toBeTruthy();
    await a.close();
    rmSync(r, { recursive: true, force: true });
  });

  it('POST agent returns 400 when prompt is missing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/workspaces/ws1/agent', payload: {} });
    expect(res.statusCode).toBe(400);
  });
```

> The second test uses the suite's shared `app`, which is built without a runner — so the route must tolerate a missing runner by validating input first, then erroring clearly if no runner is configured. The first test injects the fake runner.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run test/api.test.ts`
Expected: FAIL — `buildApi` takes 3 args / route 404.

- [ ] **Step 3: Add the route and the injectable runner**

In `src/api/server.ts`, update imports and the signature:

```typescript
import { Readable } from 'node:stream';
import type { AgentRunner } from '../agent/types.js';
```

Change the function signature:

```typescript
export function buildApi(
  engine: Engine,
  serializer: WorkspaceSerializer,
  publishStore: PublishStore,
  agentRunner?: AgentRunner,
): FastifyInstance {
```

Add this route (place it next to the other `/api/workspaces/:ws/...` routes):

```typescript
  app.post('/api/workspaces/:ws/agent', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { prompt } = (req.body ?? {}) as { prompt?: string };
    if (!prompt || !prompt.trim()) return reply.code(400).send({ error: 'prompt required' });
    if (!agentRunner) return reply.code(503).send({ error: 'agent not configured on this server' });

    reply.header('content-type', 'application/x-ndjson');
    const stream = new Readable({ read() {} });
    const write = (e: unknown) => stream.push(JSON.stringify(e) + '\n');
    agentRunner
      .run(ws, prompt, write)
      .catch((e) => write({ type: 'error', message: e instanceof Error ? e.message : String(e) }))
      .finally(() => stream.push(null));
    return reply.send(stream);
  });
```

- [ ] **Step 4: Wire the real runner in `main.ts`**

In `src/api/main.ts`, import and construct the runner, then pass it:

```typescript
import { createClaudeRunner } from '../agent/runner.js';
```

Find the `buildApi(engine, serializer, publishStore)` call and change it to:

```typescript
const app = buildApi(engine, serializer, publishStore, createClaudeRunner(root));
```

(Use whatever local variable names `main.ts` already uses for engine/serializer/publishStore/root.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/api.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/api/server.ts src/api/main.ts test/api.test.ts
git commit -m "feat(api): streaming /agent route with injectable runner"
```

---

## Task 5: Web chat panel + Assistant tab

**Files:**
- Modify: `web/src/api.ts`
- Create: `web/src/components/AgentChat.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Add the streaming client**

In `web/src/api.ts`, add to the `api` object (after `proposals`):

```typescript
  agentStream: async (
    ws: string,
    prompt: string,
    onEvent: (e: { type: string; text?: string; name?: string; result?: string; message?: string }) => void,
  ): Promise<void> => {
    const res = await fetch(`/api/workspaces/${ws}/agent`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }),
    });
    if (!res.ok || !res.body) throw new Error(await res.text());
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
    }
  },
```

- [ ] **Step 2: Create the chat panel**

Create `web/src/components/AgentChat.tsx`:

```tsx
import React, { useState } from 'react';
import { api } from '../api';

type Line = { kind: 'you' | 'text' | 'tool' | 'done' | 'error'; text: string };

const TOOL_LABEL: Record<string, string> = {
  'mcp__commons__overview': 'đọc tổng quan',
  'mcp__commons__read_state': 'xem danh sách file',
  'mcp__commons__read_file': 'đọc file',
  'mcp__commons__create_proposal': 'tạo đề xuất',
  'mcp__commons__write_proposal_file': 'viết nội dung',
  'mcp__commons__diff_proposal': 'tự rà soát',
  'mcp__commons__submit_proposal': 'gửi để duyệt',
};

export function AgentChat({ ws, onDone }: { ws: string; onDone: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setLines((l) => [...l, { kind: 'you', text: p }]);
    setPrompt(''); setBusy(true);
    try {
      await api.agentStream(ws, p, (e) => {
        if (e.type === 'text' && e.text) setLines((l) => [...l, { kind: 'text', text: e.text! }]);
        else if (e.type === 'tool' && e.name) setLines((l) => [...l, { kind: 'tool', text: TOOL_LABEL[e.name!] ?? e.name! }]);
        else if (e.type === 'done') setLines((l) => [...l, { kind: 'done', text: 'Đã tạo đề xuất — mở tab Proposals để duyệt.' }]);
        else if (e.type === 'error') setLines((l) => [...l, { kind: 'error', text: e.message ?? 'lỗi' }]);
      });
      onDone();
    } catch (err) {
      setLines((l) => [...l, { kind: 'error', text: err instanceof Error ? err.message : String(err) }]);
    } finally { setBusy(false); }
  };

  return (
    <div className="chat">
      <div className="chatlog">
        {lines.length === 0 && <p className="empty">Mô tả việc bạn muốn — ví dụ: “Viết 3 post LinkedIn từ brief tháng 6”. Trợ lý sẽ soạn một đề xuất để bạn duyệt.</p>}
        {lines.map((l, i) => (
          <div key={i} className={`chatline ${l.kind}`}>
            {l.kind === 'tool' ? <span className="chiptool">⚙ {l.text}</span> : l.text}
          </div>
        ))}
        {busy && <div className="chatline tool"><span className="chiptool">…đang làm việc</span></div>}
      </div>
      <div className="chatbox">
        <textarea
          value={prompt} disabled={busy}
          placeholder="Bạn muốn trợ lý làm gì?"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
        />
        <button className="btn approve" disabled={busy || !prompt.trim()} onClick={send}>
          {busy ? 'Đang chạy…' : 'Gửi (⌘/Ctrl+Enter)'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add the Assistant tab in `App.tsx`**

In `web/src/App.tsx`, add the import:

```tsx
import { AgentChat } from './components/AgentChat';
```

Widen the tab state type:

```tsx
  const [tab, setTab] = useState<'assistant' | 'proposals' | 'files'>('assistant');
```

In the `useEffect` that runs on `ws` change, set the default tab to assistant:

```tsx
  useEffect(() => { if (ws) { setTab('assistant'); loadProposals(ws); } }, [ws]);
```

Add the tab button (before the Proposals button) in the `.tabs` div:

```tsx
              <button className={tab === 'assistant' ? 'tab active' : 'tab'} onClick={() => setTab('assistant')}>Assistant</button>
```

Replace the tab-body ternary with a three-way switch:

```tsx
            {tab === 'assistant'
              ? <AgentChat ws={ws} onDone={() => { setTab('proposals'); loadProposals(ws); }} />
              : tab === 'proposals'
                ? <ProposalList ws={ws} proposals={proposals} onChanged={() => loadProposals(ws)} />
                : <FileBrowser ws={ws} />}
```

- [ ] **Step 4: Add chat styles**

In `web/src/styles.css`, append:

```css
/* ---------- Assistant chat ---------- */
.chat { display: flex; flex-direction: column; height: 100%; padding: 24px 28px; }
.chatlog { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
.chatline { font-size: 15px; line-height: 1.6; }
.chatline.you { align-self: flex-end; background: var(--ink); color: var(--paper); padding: 10px 14px; border-radius: 12px 12px 2px 12px; max-width: 80%; }
.chatline.text { color: var(--ink); white-space: pre-wrap; }
.chatline.done { color: var(--forest); font-weight: 600; }
.chatline.error { color: var(--vermilion); }
.chiptool { font-family: var(--mono); font-size: 12px; color: var(--ink-soft); background: var(--paper-2); border: 1px solid var(--rule); border-radius: 6px; padding: 2px 8px; }
.chatbox { display: flex; gap: 10px; align-items: flex-end; margin-top: 16px; max-width: 760px; }
.chatbox textarea { flex: 1; min-height: 56px; resize: vertical; font-family: var(--sans); font-size: 14px; padding: 12px 14px; border: 1px solid var(--rule); border-radius: 10px; background: var(--paper-2); color: var(--ink); }
.chatbox textarea:focus { outline: none; border-color: var(--ink); }
```

- [ ] **Step 5: Build the web to verify it compiles**

Run: `npx vite build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add web/src/api.ts web/src/components/AgentChat.tsx web/src/App.tsx web/src/styles.css
git commit -m "feat(web): Assistant chat tab driving the scoped agent"
```

---

## Task 6: Live smoke test + docs

**Files:**
- Modify: `KNOWN_LIMITATIONS.md`
- Modify: `README.md`

- [ ] **Step 1: Live smoke test (manual, requires Claude Code login)**

Ensure the dev servers run (`npm run dev`), open the web app, pick a workspace, go to the **Assistant** tab, and send:
`Viết một post LinkedIn ngắn giới thiệu commons, dựa trên reference/ nếu có.`

Expected: streaming tool chips (đọc tổng quan → tạo đề xuất → viết nội dung → gửi để duyệt), then "Đã tạo đề xuất". Switch to Proposals → a new submitted proposal exists → open "Bản đọc" → it renders as a document. Approve works.

If the run errors with an auth message, confirm `claude` CLI is logged in on this machine (the SDK rides that login). For production, set `ANTHROPIC_API_KEY`.

- [ ] **Step 2: Document the limitation**

In `KNOWN_LIMITATIONS.md`, under "Deferred (document, fix later)", add:

```markdown
### 5. Built-in web agent: auth, cost, and concurrency
The web Assistant runs the Claude Agent SDK in-process. Caveats:
- **Auth/cost:** locally it rides the machine's Claude Code subscription login (≈0 marginal cost, weekly headless token pool from 2026-06-15). Production must set `ANTHROPIC_API_KEY` (pay-per-token). The `AgentRunner` boundary isolates this swap.
- **Concurrency:** each run spawns the commons **stdio** MCP as a separate process with its own serializer. Two agent runs (or an agent run + a web merge) on the *same workspace* at the *same time* rely on git's file locking only (see #1/#1b). Fine for single-user dogfooding; revisit for multi-user.
- **No mid-run cancel** and **no per-user token budget** yet.
```

- [ ] **Step 3: Document usage in the README**

In `README.md`, add a short "Web Assistant (built-in agent)" section explaining: the Assistant tab lets a user prompt without any external harness; it is scoped to commons tools only; it needs the `claude` CLI logged in locally (or `ANTHROPIC_API_KEY`); the MCP server remains for power users who prefer their own harness. Set the model via `COMMONS_AGENT_MODEL` (default `claude-sonnet-4-6`).

- [ ] **Step 4: Commit**

```bash
git add KNOWN_LIMITATIONS.md README.md
git commit -m "docs: web Assistant agent — scope, auth, cost, limitations"
```

---

## Self-Review

**Spec coverage:**
- "prompt on the web" → Task 5 (AgentChat + Assistant tab) + Task 4 (route). ✓
- "uses Claude's harness, not raw API" → Task 1/3 use `@anthropic-ai/claude-agent-sdk` `query()`; auth rides Claude Code login. ✓
- "scoped, not as powerful as Claude Code" → Task 1: `allowedTools` = 9 commons tools, `disallowedTools` = all built-ins, `settingSources: []`, narrow `systemPrompt`, Sonnet. ✓
- "MCP stays for power users" → MCP server untouched; the agent merely *consumes* it as stdio. ✓
- "production-swap concern" → `AgentRunner` boundary (Task 1 types, Task 3 impl, Task 4 injectable); API-key swap is env-only, documented Task 6. ✓
- "governance intact (agent proposes, human disposes)" → commons MCP never exposed merge/discard; agent can't reach them; verified by Task 1 test. ✓

**Placeholder scan:** every code step shows full code; commands have expected output; no TBD/TODO. ✓ (Task 3 intentionally has no CI unit test — justified: non-deterministic LLM call; covered by the Task 6 live smoke test and by unit-testing its pure dependencies.)

**Type consistency:** `AgentRunner.run(workspace, prompt, onEvent) => Promise<AgentResult>` is used identically in the runner (Task 3), the route (Task 4), and the fake runner (Task 4 test). `AgentEvent` variants (`text`/`tool`/`done`/`error`) match across `events.ts`, `runner.ts`, `AgentChat.tsx`. `COMMONS_TOOLS` defined in `options.ts`, asserted in its test. ✓

**Known risk to watch during execution:** `commonsStdioPath()` uses `import.meta.url` path math; on Windows the `file:///C:/...` → path conversion is handled by the `.replace(/^\/([A-Za-z]:)/, '$1')`. If the live smoke test (Task 6) shows the MCP failing to spawn, log the resolved path and adjust — this is the one spot that can't be unit-tested meaningfully.
