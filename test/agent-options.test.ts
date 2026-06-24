import { describe, it, expect } from 'vitest';
import { buildAgentOptions, framePrompt, COMMONS_TOOLS, DEFAULT_AGENT_MODEL } from '../src/agent/options.js';

describe('buildAgentOptions', () => {
  it('scopes the agent to commons tools only', () => {
    const o = buildAgentOptions('/data');
    expect(o.allowedTools).toEqual(COMMONS_TOOLS);
    expect(o.allowedTools).toContain('mcp__commons__create_proposal');
    expect(o.allowedTools).toContain('mcp__commons__overview');
    // overview already lists workspaces with counts; list_workspaces is not granted.
    expect(o.allowedTools).not.toContain('mcp__commons__list_workspaces');
    expect(o.disallowedTools).toEqual(expect.arrayContaining(['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch']));
    expect(o.allowedTools).not.toContain('mcp__commons__merge_proposal');
  });

  it('loads no global settings and only the commons MCP server', () => {
    const o = buildAgentOptions('/data');
    expect(o.settingSources).toEqual([]);
    expect(Object.keys(o.mcpServers ?? {})).toEqual(['commons']);
    expect((o.mcpServers as any).commons.env.COMMONS_ROOT).toBe('/data');
  });

  it('uses a modest model and a workspace-independent system prompt (stable cache prefix)', () => {
    const o = buildAgentOptions('/data');
    expect(o.model).toBe(DEFAULT_AGENT_MODEL);
    expect(typeof o.systemPrompt).toBe('string');
    // The prompt must NOT bake in a workspace id, so the cached prefix is reused across workspaces.
    expect(o.systemPrompt as string).not.toContain('march-campaign');
    expect(o.systemPrompt as string).toContain('proposal');
    expect(o.maxTurns).toBeGreaterThan(0);
  });

  it('framePrompt carries the workspace id in the user turn, not the system prompt', () => {
    const framed = framePrompt('march-campaign', 'write a post about spring');
    expect(framed).toContain('march-campaign');
    expect(framed).toContain('write a post about spring');
  });
});
