import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Engine } from '../engine/types.js';
import { WorkspaceSerializer } from '../util/serializer.js';
import { generateId } from '../util/id.js';
import { createTools } from './tools.js';

export function buildServer(engine: Engine): McpServer {
  const server = new McpServer({ name: 'commons', version: '0.1.0' });
  const tools = createTools({ engine, serializer: new WorkspaceSerializer(), genId: generateId });
  for (const t of tools) {
    server.registerTool(
      t.name,
      { description: t.description, inputSchema: t.inputSchema },
      async (args: any) => ({ content: [{ type: 'text', text: await t.run(args) }] }),
    );
  }
  return server;
}
