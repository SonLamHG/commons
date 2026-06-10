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
