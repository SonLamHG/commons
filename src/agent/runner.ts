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
