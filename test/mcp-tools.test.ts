import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/engine/index.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { generateId } from '../src/util/id.js';
import { createTools } from '../src/mcp/tools.js';
import type { ToolDef } from '../src/mcp/tools.js';

let root: string;
let tools: Record<string, ToolDef>;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'commons-mcp-'));
  const engine = createEngine(root);
  await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
  const list = createTools({ engine, serializer: new WorkspaceSerializer(), genId: generateId });
  tools = Object.fromEntries(list.map((t) => [t.name, t]));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('mcp tools', () => {
  it('exposes the agent-facing surface and NOT merge/discard', () => {
    expect(Object.keys(tools).sort()).toEqual(
      ['create_proposal', 'diff_proposal', 'list_proposals', 'list_workspaces', 'overview', 'read_file', 'read_state', 'submit_proposal', 'write_proposal_file'].sort(),
    );
    expect(tools['merge_proposal']).toBeUndefined();
    expect(tools['discard_proposal']).toBeUndefined();
  });

  it('list_workspaces returns existing workspaces', async () => {
    const out = await tools['list_workspaces'].run({});
    expect(out).toContain('ws1');
  });

  it('overview summarizes each workspace with file and pending-proposal counts', async () => {
    const created = await tools['create_proposal'].run({ workspace: 'ws1', title: 'draft' });
    const proposalId = created.trim();
    await tools['write_proposal_file'].run({ workspace: 'ws1', proposalId, path: 'b.md', content: 'bee' });
    await tools['submit_proposal'].run({ workspace: 'ws1', proposalId, message: 'add b' });

    const out = await tools['overview'].run({});
    expect(out).toContain('ws1');
    expect(out).toContain('1'); // 1 file (a.md) and 1 pending proposal
    expect(out.toLowerCase()).toContain('pending');
  });

  it('runs the full propose flow: create -> write -> submit -> diff', async () => {
    const created = await tools['create_proposal'].run({ workspace: 'ws1', title: 'draft' });
    const proposalId = created.trim();
    expect(proposalId).toMatch(/^p-[A-Za-z0-9_-]+$/);

    await tools['write_proposal_file'].run({ workspace: 'ws1', proposalId, path: 'b.md', content: 'bee' });
    await tools['submit_proposal'].run({ workspace: 'ws1', proposalId, message: 'add b' });

    const proposals = await tools['list_proposals'].run({ workspace: 'ws1' });
    expect(proposals).toContain('submitted');

    const diff = await tools['diff_proposal'].run({ workspace: 'ws1', proposalId });
    expect(diff).toContain('b.md');

    const state = await tools['read_state'].run({ workspace: 'ws1' });
    expect(state).not.toContain('b.md');
    expect(state).toContain('a.md');
  });

  it('read_file returns content', async () => {
    expect(await tools['read_file'].run({ workspace: 'ws1', path: 'a.md' })).toBe('hello');
  });

  it('write_proposal_file description guides agents to drafts/', () => {
    const list = createTools({ engine: createEngine(root), serializer: new WorkspaceSerializer(), genId: generateId });
    const t = list.find((x) => x.name === 'write_proposal_file')!;
    expect(t.description).toContain('drafts/');
  });
});
