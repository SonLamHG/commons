import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTraceWriter } from '../src/agent/trace.js';
import { traceDirFromEnv } from '../src/agent/runner.js';
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

describe('traceDirFromEnv', () => {
  it('returns the dir when COMMONS_TRACE_DIR is set', () => {
    expect(traceDirFromEnv({ COMMONS_TRACE_DIR: 'data/traces' } as any)).toBe('data/traces');
  });
  it('returns undefined when unset or blank', () => {
    expect(traceDirFromEnv({} as any)).toBeUndefined();
    expect(traceDirFromEnv({ COMMONS_TRACE_DIR: '  ' } as any)).toBeUndefined();
  });
});
