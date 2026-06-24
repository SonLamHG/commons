import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
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
  const file = join(dir, `${meta.workspace}-${runId}.ndjson`);
  writeFileSync(file, ''); // truncate/create
  let turn = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCacheCreationTokens = 0;

  const writeLine = (obj: unknown) => appendFileSync(file, JSON.stringify(obj) + '\n');

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
      /* sync writes — nothing to flush */
    },
  };
}
