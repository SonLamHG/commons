import { z, type ZodRawShape } from 'zod';
import type { Engine } from '../engine/types.js';
import type { WorkspaceSerializer } from '../util/serializer.js';
import type { ImageGenerator } from '../image/types.js';

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
  imageGenerator: ImageGenerator;
}

export function createTools({ engine, serializer, genId, imageGenerator }: ToolDeps): ToolDef[] {
  return [
    {
      name: 'overview',
      description:
        'START HERE. A snapshot of every workspace with its file count and how many proposals are pending human review. Call this first to orient yourself before any other tool.',
      inputSchema: {},
      run: async () => {
        const workspaces = await engine.listWorkspaces();
        if (workspaces.length === 0) return '(no workspaces yet)';
        const lines = await Promise.all(
          workspaces.map(async (ws) => {
            const nodes = await engine.readState(ws);
            const files = nodes.filter((n) => n.type === 'file').length;
            const proposals = await engine.listProposals(ws);
            const pending = proposals.filter((p) => p.status === 'submitted').length;
            return `${ws}: ${files} file(s), ${pending} pending proposal(s) awaiting review`;
          }),
        );
        return lines.join('\n');
      },
    },
    {
      name: 'list_workspaces',
      description: 'List the ids of all workspaces. Use overview instead if you also want counts.',
      inputSchema: {},
      run: async () => {
        const workspaces = await engine.listWorkspaces();
        return workspaces.length > 0 ? workspaces.join('\n') : '(no workspaces yet)';
      },
    },
    {
      name: 'read_state',
      description:
        'List the files approved into a workspace (durable main state). Proposals in progress are NOT reflected here — use diff_proposal to see a proposal’s pending changes.',
      inputSchema: { workspace: z.string() },
      run: async ({ workspace }) => {
        const nodes = await engine.readState(workspace);
        const files = nodes.filter((n) => n.type === 'file').map((n) => n.path);
        return files.length > 0 ? files.join('\n') : '(no files)';
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
      description:
        'Write a file inside a proposal (does not touch durable state until merged by a human). ' +
        'Place drafted content under drafts/, read background from reference/, and never overwrite reference/.',
      inputSchema: { workspace: z.string(), proposalId: z.string(), path: z.string(), content: z.string() },
      run: async ({ workspace, proposalId, path, content }) => {
        await serializer.run(workspace, () => engine.writeProposalFile(workspace, proposalId, path, content));
        return `wrote ${path}`;
      },
    },
    {
      name: 'generate_image',
      description:
        'Generate an image for a post and save it inside a proposal worktree. ' +
        'Save under assets/ (e.g. assets/<item>/cover.png). After it succeeds, reference ' +
        'the image in your post Markdown with ![alt](<relative path to the image>) so it ' +
        'shows up in review and gets attached when published.',
      inputSchema: {
        workspace: z.string(),
        proposalId: z.string(),
        prompt: z.string(),
        path: z.string(),
        aspectRatio: z.enum(['1:1', '16:9', '9:16']).optional(),
      },
      run: async ({ workspace, proposalId, prompt, path, aspectRatio }) => {
        let image;
        try {
          image = await imageGenerator.generate({ prompt, aspectRatio });
        } catch (e) {
          return `image generation failed: ${e instanceof Error ? e.message : String(e)}`;
        }
        await serializer.run(workspace, () =>
          engine.writeProposalFileBytes(workspace, proposalId, path, image.bytes),
        );
        const kb = Math.round(image.bytes.length / 1024);
        return `wrote ${path} (${image.mime}, ${kb}KB). Reference it in your post as ![alt](${path}).`;
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
      description:
        'Show the per-file diff a proposal would apply to main. Call after writing files and before submitting, to review your own changes.',
      inputSchema: { workspace: z.string(), proposalId: z.string() },
      run: async ({ workspace, proposalId }) => {
        const diffs = await engine.diffProposal(workspace, proposalId);
        return diffs.map((d) => `[${d.status}] ${d.path}\n${d.diff}`).join('\n\n');
      },
    },
  ];
}
