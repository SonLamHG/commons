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
  'generate_image',
  'submit_proposal',
  'diff_proposal',
].map((t) => `mcp__${SERVER}__${t}`);

const DENY_BUILTINS = [
  'Bash', 'Edit', 'Write', 'Read', 'MultiEdit', 'NotebookEdit', 'NotebookRead',
  'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch', 'TodoWrite', 'Task',
  'KillShell', 'BashOutput', 'ExitPlanMode', 'SlashCommand', 'ToolSearch',
  // Skill/Agent let the model load host skills (e.g. `init`) or spawn subagents,
  // which derails it from the commons MCP workflow into an empty proposal.
  'Skill', 'Agent',
];

/** Default agent model: a modest, low-cost model. Override with COMMONS_AGENT_MODEL. */
export const DEFAULT_AGENT_MODEL = 'claude-haiku-4-5-20251001';
const MODEL = process.env.COMMONS_AGENT_MODEL ?? DEFAULT_AGENT_MODEL;

function systemPrompt(workspace: string): string {
  return [
    `You are the drafting assistant for the knowledge-work workspace "${workspace}".`,
    `Your ONLY job is to turn the user's request into a single reviewable proposal that a human will approve or reject. You do not publish and you cannot merge.`,
    ``,
    `Every tool you have is named with the prefix "mcp__commons__" — always invoke tools by that exact full name (for example mcp__commons__overview), never a bare name like "overview" or an invented one. Your very first action must be a call to mcp__commons__overview.`,
    ``,
    `Workflow, in order:`,
    `1. Call mcp__commons__overview, then mcp__commons__read_state / mcp__commons__read_file, to understand the current content and any material under reference/.`,
    `2. mcp__commons__create_proposal with a short, human-readable title.`,
    `3. mcp__commons__write_proposal_file for each file you add or change (Markdown). When an image would strengthen the post, call mcp__commons__generate_image to create one under assets/ (at the workspace root) and reference it in the Markdown with a path RELATIVE TO THE MARKDOWN FILE, not the workspace root. Example: a post at drafts/foo.md must reference ![alt](../assets/foo.png) — climb out of drafts/ with ../ first. Getting this wrong renders a broken image.`,
    `4. mcp__commons__diff_proposal to check your own changes, then mcp__commons__submit_proposal.`,
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
        env: {
          COMMONS_ROOT: absRoot,
          ...(process.env.GEMINI_API_KEY ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY } : {}),
          ...(process.env.COMMONS_IMAGE_MODEL ? { COMMONS_IMAGE_MODEL: process.env.COMMONS_IMAGE_MODEL } : {}),
        },
      },
    },
  };
}
