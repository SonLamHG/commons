import { describe, it, expect } from 'vitest';
import { scoreRun } from '../src/bench/score.js';
import type { AgentEvent } from '../src/agent/types.js';
import type { FileDiff } from '../src/engine/types.js';

const tool = (name: string, workspace?: string): AgentEvent => ({
  type: 'tool', name, input: workspace ? { workspace } : {},
});
const draftDiff: FileDiff[] = [{ path: 'drafts/post.md', status: 'added', diff: '+x' }];

describe('scoreRun', () => {
  it('passes when all four criteria hold', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [
        tool('mcp__commons__overview', 'ws1'),
        tool('mcp__commons__create_proposal', 'ws1'),
      ],
      newProposals: [{ status: 'submitted', diffs: draftDiff }],
    });
    expect(s).toEqual({ proposal: true, firstCall: true, noStrayTools: true, rightWorkspace: true, pass: true });
  });

  it('fails proposal when no submitted proposal with a drafts/ file', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [tool('mcp__commons__overview', 'ws1')],
      newProposals: [{ status: 'open', diffs: draftDiff }],
    });
    expect(s.proposal).toBe(false);
    expect(s.pass).toBe(false);
  });

  it('fails firstCall when first tool is not overview', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [tool('mcp__commons__read_state', 'ws1')],
      newProposals: [{ status: 'submitted', diffs: draftDiff }],
    });
    expect(s.firstCall).toBe(false);
  });

  it('fails noStrayTools on a tool outside COMMONS_TOOLS', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [tool('mcp__commons__overview', 'ws1'), tool('mcp__commons__list_workspaces', 'ws1')],
      newProposals: [{ status: 'submitted', diffs: draftDiff }],
    });
    expect(s.noStrayTools).toBe(false);
  });

  it('fails rightWorkspace on a wrong workspace id', () => {
    const s = scoreRun({
      workspace: 'ws1',
      events: [tool('mcp__commons__overview', 'ws1'), tool('mcp__commons__read_state', 'other')],
      newProposals: [{ status: 'submitted', diffs: draftDiff }],
    });
    expect(s.rightWorkspace).toBe(false);
  });
});
