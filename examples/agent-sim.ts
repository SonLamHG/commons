/**
 * Zero-config demo: simulates exactly what a real AI agent (Claude) does over MCP.
 * It SPAWNS the real Commons MCP server (the same `npm run mcp` process Claude would
 * talk to) and drives it tool-by-tool, printing each step like a conversation.
 *
 * Run:  npm run agent-sim
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { join } from 'node:path';

const root = join(process.cwd(), 'data');
const WS = 'content-calendar';
const line = (s = '') => console.log(s);
const step = (t: string) => line('\n' + '─'.repeat(60) + '\n' + t + '\n' + '─'.repeat(60));
const text = (r: any) => (r.content?.[0]?.text ?? '').trim();

async function main() {
  step('Agent ket noi toi Commons MCP server (spawn process that)');
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/mcp/stdio.ts'],
    env: { ...process.env, COMMONS_ROOT: root },
  });
  const client = new Client({ name: 'agent-sim', version: '0.0.0' });
  await client.connect(transport);

  step('Agent hoi: co nhung tool gi? (chu y: KHONG co merge/discard)');
  const { tools } = await client.listTools();
  line(tools.map((t) => '  - ' + t.name).join('\n'));

  step(`Agent doc state cua workspace "${WS}"`);
  line(text(await client.callTool({ name: 'read_state', arguments: { workspace: WS } })));

  step('Agent doc brand-voice.md de hieu giong dieu');
  line(text(await client.callTool({ name: 'read_file', arguments: { workspace: WS, path: 'brand-voice.md' } })));

  step('Agent MO proposal (worktree co lap)');
  const id = text(await client.callTool({ name: 'create_proposal', arguments: { workspace: WS, title: 'Draft: weekly tips' } }));
  line('  proposalId = ' + id);

  step('Agent VIET draft vao proposal (main chua bi dong toi)');
  await client.callTool({ name: 'write_proposal_file', arguments: { workspace: WS, proposalId: id, path: 'items/2026-06-15-tips/post.md', content: '# 5 tips for B2B founders\n1. Talk to users.\n' } });
  line('  wrote items/2026-06-15-tips/post.md');

  step('Agent SUBMIT de human review');
  await client.callTool({ name: 'submit_proposal', arguments: { workspace: WS, proposalId: id, message: 'draft weekly tips' } });
  line('  submitted');

  step('Diff agent de xuat (DAY la cai human se duyet trong UI tuong lai)');
  line(text(await client.callTool({ name: 'diff_proposal', arguments: { workspace: WS, proposalId: id } })));

  step('Agent THU merge? -> khong co tool merge. An toan.');
  const hasMerge = tools.some((t) => t.name.includes('merge'));
  line('  co tool merge cho agent? ' + hasMerge + '  <- agent KHONG the tu duyet');

  await client.close();
  step(`Xong. Inspect git that: data/repos/${WS}  (git branch -a / git worktree list)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
