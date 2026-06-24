import { query } from '@anthropic-ai/claude-agent-sdk';
import type { AgentRunner } from './types.js';
import { buildAgentOptions, framePrompt } from './options.js';
import { toAgentEvent } from './events.js';

/** A runner backed by the Claude Code harness (Agent SDK). The agent's MCP child
 *  is rooted at the caller-supplied tenant storage root, isolating tenants. */
export function createClaudeRunner(): AgentRunner {
  return {
    async run(tenantRoot, workspace, prompt, onEvent) {
      let costUsd = 0;
      let numTurns = 0;
      let ok = false;
      for await (const msg of query({ prompt: framePrompt(workspace, prompt), options: buildAgentOptions(tenantRoot) })) {
        for (const e of toAgentEvent(msg)) {
          if (e.type === 'done') { ok = true; costUsd = e.costUsd; numTurns = e.numTurns; }
          onEvent(e);
        }
      }
      return { ok, costUsd, numTurns };
    },
  };
}
