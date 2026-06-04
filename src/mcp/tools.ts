import { z, type ZodRawShape } from 'zod';
import type { Engine } from '../engine/types.js';
import type { WorkspaceSerializer } from './serializer.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  run: (args: any) => Promise<string>;
}

export interface ToolDeps {
  engine: Engine;
  serializer: WorkspaceSerializer;
  genId: (prefix?: string) => string;
}

export function createTools({ engine, serializer, genId }: ToolDeps): ToolDef[] {
  return [
    {
      name: 'read_state',
      description: 'List the files in a workspace (durable main state).',
      inputSchema: { workspace: z.string() },
      run: async ({ workspace }) => {
        const nodes = await engine.readState(workspace);
        return nodes.filter((n) => n.type === 'file').map((n) => n.path).join('\n');
      },
    },
    {
      name: 'read_file',
      description: 'Read a file from a workspace (durable main state).',
      inputSchema: { workspace: z.string(), path: z.string() },
      run: async ({ workspace, path }) => engine.readFile(workspace, path),
    },
    {
      name: 'list_proposals',
      description: 'List proposals in a workspace with their status.',
      inputSchema: { workspace: z.string() },
      run: async ({ workspace }) => {
        const ps = await engine.listProposals(workspace);
        return JSON.stringify(ps, null, 2);
      },
    },
    {
      name: 'create_proposal',
      description: 'Open a new isolated proposal (a sandboxed worktree). Returns the proposal id.',
      inputSchema: { workspace: z.string(), title: z.string() },
      run: async ({ workspace, title }) => {
        const id = genId('p');
        await serializer.run(workspace, () => engine.createProposal(workspace, { id, title }));
        return id;
      },
    },
    {
      name: 'write_proposal_file',
      description: 'Write a file inside a proposal (does not touch durable state until merged by a human).',
      inputSchema: { workspace: z.string(), proposalId: z.string(), path: z.string(), content: z.string() },
      run: async ({ workspace, proposalId, path, content }) => {
        await serializer.run(workspace, () => engine.writeProposalFile(workspace, proposalId, path, content));
        return `wrote ${path}`;
      },
    },
    {
      name: 'submit_proposal',
      description: 'Commit a proposal so a human can review and approve it.',
      inputSchema: { workspace: z.string(), proposalId: z.string(), message: z.string() },
      run: async ({ workspace, proposalId, message }) => {
        await serializer.run(workspace, () => engine.submitProposal(workspace, proposalId, message));
        return `submitted ${proposalId}`;
      },
    },
    {
      name: 'diff_proposal',
      description: 'Show the per-file diff a proposal would apply to main.',
      inputSchema: { workspace: z.string(), proposalId: z.string() },
      run: async ({ workspace, proposalId }) => {
        const diffs = await engine.diffProposal(workspace, proposalId);
        return diffs.map((d) => `[${d.status}] ${d.path}\n${d.diff}`).join('\n\n');
      },
    },
  ];
}
