/**
 * HTTP transport demo: simulates what a non-Claude harness (ChatGPT, Cursor) does
 * when connecting to the Commons MCP server over Streamable HTTP.
 *
 * Prerequisites: start the HTTP server first:
 *   COMMONS_ROOT=./data MCP_HTTP_PORT=8765 npx tsx src/mcp/http.ts
 *
 * Run:
 *   COMMONS_ROOT=./data npx tsx examples/agent-sim-http.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const SERVER_URL = new URL('http://localhost:8765/mcp');
const WS = 'content-calendar';
const line = (s = '') => console.log(s);
const step = (t: string) => line('\n' + '─'.repeat(60) + '\n' + t + '\n' + '─'.repeat(60));
const text = (r: any) => (r.content?.[0]?.text ?? '').trim();

async function main() {
  step('Step 1 — Connect to Commons MCP server over HTTP (Streamable)');
  const transport = new StreamableHTTPClientTransport(SERVER_URL);
  const client = new Client({ name: 'agent-sim-http', version: '0.0.0' });
  await client.connect(transport);
  line('  Connected to ' + SERVER_URL.href);

  step('Step 2 — List tools (assert NO merge/discard)');
  const { tools } = await client.listTools();
  line(tools.map((t) => '  - ' + t.name).join('\n'));
  const hasMerge = tools.some((t) => t.name.includes('merge') || t.name.includes('discard'));
  if (hasMerge) throw new Error('FAIL: merge/discard tools are exposed — should NOT be');
  line('\n  OK: no merge/discard tools found');

  step(`Step 3 — read_state for workspace "${WS}"`);
  line(text(await client.callTool({ name: 'read_state', arguments: { workspace: WS } })));

  step('Step 4 — create_proposal');
  const proposalId = text(await client.callTool({
    name: 'create_proposal',
    arguments: { workspace: WS, title: 'HTTP harness test' },
  }));
  line('  proposalId = ' + proposalId);

  step('Step 5 — write_proposal_file');
  await client.callTool({
    name: 'write_proposal_file',
    arguments: {
      workspace: WS,
      proposalId,
      path: 'items/2026-06-20-http/post.md',
      content: '# HTTP Harness Test\n\nThis post was created via Streamable HTTP MCP transport.\n',
    },
  });
  line('  wrote items/2026-06-20-http/post.md');

  step('Step 6 — submit_proposal');
  await client.callTool({
    name: 'submit_proposal',
    arguments: { workspace: WS, proposalId, message: 'http harness test post' },
  });
  line('  submitted');

  step('Step 7 — list_proposals and confirm submitted status');
  const listResult = text(await client.callTool({ name: 'list_proposals', arguments: { workspace: WS } }));
  line(listResult);
  if (!listResult.includes(proposalId) || !listResult.toLowerCase().includes('submitted')) {
    throw new Error('FAIL: proposal not found or not in submitted state');
  }
  line('\n  OK: proposal ' + proposalId + ' is submitted');

  await client.close();
  step('Done. Proposal created via HTTP transport: ' + proposalId);
}

main().catch((e) => { console.error(e); process.exit(1); });
