import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Options } from '@anthropic-ai/claude-agent-sdk';

const SERVER = 'commons';

export const COMMONS_TOOLS = [
  'overview',
  'list_workspaces',
  'read_state',
  'read_file',
  'list_proposals',
  'create_proposal',
  'write_proposal_file',
  'submit_proposal',
  'diff_proposal',
].map((t) => `mcp__${SERVER}__${t}`);

const DENY_BUILTINS = [
  'Bash', 'Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit', 'NotebookRead',
  'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task',
  'KillShell', 'BashOutput', 'ExitPlanMode', 'SlashCommand',
];

const MODEL = process.env.COMMONS_AGENT_MODEL ?? 'claude-sonnet-4-6';

function systemPrompt(workspace: string): string {
  return [
    `You are the drafting assistant for the knowledge-work workspace "${workspace}".`,
    `Your ONLY job is to turn the user's request into a single reviewable proposal that a human will approve or reject. You do not publish and you cannot merge.`,
    ``,
    `Workflow, in order:`,
    `1. Call overview, then read_state / read_file, to understand the current content and any material under reference/.`,
    `2. create_proposal with a short, human-readable title.`,
    `3. write_proposal_file for each file you add or change (Markdown).`,
    `4. diff_proposal to check your own changes, then submit_proposal.`,
    ``,
    `Rules: use only the commons tools available to you. Keep deliverables in Markdown. If the request is ambiguous, make reasonable assumptions and state them at the top of the draft. Do not ask the user follow-up questions — produce the best proposal you can in one pass.`,
  ].join('\n');
}

/** Absolute path to src/mcp/stdio.ts, resolved from this module's location. */
export function commonsStdioPath(): string {
  // On Windows, import.meta.url is file:///C:/..., fileURLToPath handles the conversion
  const thisFile = fileURLToPath(import.meta.url);
  // src/agent/options.ts -> src/mcp/stdio.ts
  return resolve(thisFile, '../../mcp/stdio.ts');
}

export function buildAgentOptions(root: string, workspace: string): Options {
  const absRoot = root;
  const isWin = process.platform === 'win32';
  return {
    model: MODEL,
    systemPrompt: systemPrompt(workspace),
    maxTurns: 24,
    permissionMode: 'default',
    settingSources: [],
    allowedTools: COMMONS_TOOLS,
    disallowedTools: DENY_BUILTINS,
    mcpServers: {
      [SERVER]: {
        type: 'stdio',
        command: isWin ? 'cmd' : 'npx',
        args: isWin ? ['/c', 'npx', 'tsx', commonsStdioPath()] : ['tsx', commonsStdioPath()],
        env: { COMMONS_ROOT: absRoot },
      },
    },
  };
}
