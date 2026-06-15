import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngine } from '../src/engine/index.js';
import { buildServer } from '../src/mcp/server.js';

let root: string;
let client: Client;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'commons-srv-'));
  const engine = createEngine(root);
  await engine.createWorkspace({ id: 'ws1', seed: { 'a.md': 'hello' } });
  const server = buildServer(engine);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});
afterEach(async () => {
  await client.close();
  rmSync(root, { recursive: true, force: true });
});

describe('mcp server (in-process MCP protocol)', () => {
  it('lists exactly the agent tools, with no merge/discard', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['create_proposal', 'diff_proposal', 'generate_image', 'list_proposals', 'list_workspaces', 'overview', 'read_file', 'read_state', 'submit_proposal', 'write_proposal_file'].sort(),
    );
    expect(names).not.toContain('merge_proposal');
    expect(names).not.toContain('discard_proposal');
  });

  it('drives a full propose flow over the protocol (isolation holds)', async () => {
    const created = await client.callTool({ name: 'create_proposal', arguments: { workspace: 'ws1', title: 'draft' } });
    const proposalId = (created.content as any)[0].text.trim();
    expect(proposalId).toMatch(/^p-/);

    await client.callTool({ name: 'write_proposal_file', arguments: { workspace: 'ws1', proposalId, path: 'b.md', content: 'bee' } });
    await client.callTool({ name: 'submit_proposal', arguments: { workspace: 'ws1', proposalId, message: 'add b' } });

    const state = await client.callTool({ name: 'read_state', arguments: { workspace: 'ws1' } });
    const stateText = (state.content as any)[0].text;
    expect(stateText).toContain('a.md');
    expect(stateText).not.toContain('b.md'); // isolation over the wire
  });
});
