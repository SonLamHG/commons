import { describe, it, expect } from 'vitest';
import { buildAgentOptions, COMMONS_TOOLS } from '../src/agent/options.js';

describe('buildAgentOptions', () => {
  it('scopes the agent to commons tools only', () => {
    const o = buildAgentOptions('/data', 'ws1');
    expect(o.allowedTools).toEqual(COMMONS_TOOLS);
    expect(o.allowedTools).toContain('mcp__commons__create_proposal');
    expect(o.allowedTools).toContain('mcp__commons__overview');
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch']));
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
