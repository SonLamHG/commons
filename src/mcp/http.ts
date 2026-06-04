import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { join } from 'node:path';
import { createEngine } from '../engine/index.js';
import { buildServer } from './server.js';

const root = process.env.COMMONS_ROOT ?? join(process.cwd(), 'data');
const port = Number(process.env.MCP_HTTP_PORT ?? 8765);

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  // Stateless mode: fresh server + transport per request (no session state)
  const server = buildServer(createEngine(root));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

// Return 405 for GET/DELETE — stateless mode does not support SSE or session termination
app.get('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method Not Allowed — use POST for stateless MCP' });
});
app.delete('/mcp', (_req, res) => {
  res.status(405).json({ error: 'Method Not Allowed — stateless mode has no sessions to terminate' });
});

app.listen(port, () => process.stdout.write(`commons MCP (HTTP) on http://localhost:${port}/mcp\n`));
