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
