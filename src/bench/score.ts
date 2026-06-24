import type { AgentEvent } from '../agent/types.js';
import type { FileDiff } from '../engine/types.js';
import { COMMONS_TOOLS } from '../agent/options.js';

export interface RunScore {
  proposal: boolean;
  firstCall: boolean;
  noStrayTools: boolean;
  rightWorkspace: boolean;
  pass: boolean;
}

export function scoreRun(input: {
  workspace: string;
  events: AgentEvent[];
  newProposals: Array<{ status: string; diffs: FileDiff[] }>;
}): RunScore {
  const toolEvents = input.events.filter(
    (e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool',
  );
  const allowed = new Set(COMMONS_TOOLS);

  const proposal = input.newProposals.some(
    (p) => p.status === 'submitted' && p.diffs.some((d) => d.path.startsWith('drafts/')),
  );
  const firstCall = toolEvents[0]?.name === 'mcp__commons__overview';
  const noStrayTools = toolEvents.every((t) => allowed.has(t.name));
  const rightWorkspace = toolEvents.every((t) => {
    const ws = (t.input as { workspace?: string } | undefined)?.workspace;
    return ws === undefined || ws === input.workspace;
  });

  return {
    proposal,
    firstCall,
    noStrayTools,
    rightWorkspace,
    pass: proposal && firstCall && noStrayTools && rightWorkspace,
  };
}
