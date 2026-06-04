import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { join } from 'node:path';
import { createEngine } from '../engine/index.js';
import { buildServer } from './server.js';

const root = process.env.COMMONS_ROOT ?? join(process.cwd(), 'data');
const server = buildServer(createEngine(root));

async function main() {
  await server.connect(new StdioServerTransport());
  // NOTE: never console.log to stdout here — it corrupts the JSON-RPC stream. Use stderr only.
}

main().catch((e) => {
  process.stderr.write(`commons mcp failed: ${String(e)}\n`);
  process.exit(1);
});
