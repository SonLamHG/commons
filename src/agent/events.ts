import type { AgentEvent } from './types.js';

// SDKMessage shape based on the Agent SDK's actual output structure
type SDKMessage = { type: string };

type AssistantMessage = {
  type: 'assistant';
  message?: {
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  };
};

type ResultMessage = {
  type: 'result';
  subtype?: string;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  errors?: string[];
};

/** Map one SDK message to zero or more AgentEvents the web cares about. */
export function toAgentEvent(msg: SDKMessage): AgentEvent[] {
  if (msg.type === 'assistant') {
    const m = msg as AssistantMessage;
    const out: AgentEvent[] = [];
    const content = m.message?.content ?? [];
    for (const c of content) {
      if (c.type === 'text' && c.text) out.push({ type: 'text', text: c.text });
      else if (c.type === 'tool_use') out.push({ type: 'tool', name: c.name, input: c.input });
    }
    return out;
  }
  if (msg.type === 'result') {
    const m = msg as ResultMessage;
    if (m.subtype === 'success') {
      return [{ type: 'done', result: m.result ?? '', costUsd: m.total_cost_usd ?? 0, numTurns: m.num_turns ?? 0 }];
    }
    return [{ type: 'error', message: (m.errors ?? ['agent failed']).join('; ') }];
  }
  return [];
}
