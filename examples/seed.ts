import { createEngine } from '../src/engine/index.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

// Seeds a persistent workspace for manual MCP testing with a real agent harness.
// Uses the same COMMONS_ROOT the MCP server uses (default ./data).
const root = process.env.COMMONS_ROOT ?? join(process.cwd(), 'data');
const engine = createEngine(root);
const ws = 'content-calendar';

const main = async () => {
  if (existsSync(join(root, 'repos', ws, '.git'))) {
    console.log(`workspace "${ws}" already exists at ${join(root, 'repos', ws)}`);
    return;
  }
  await engine.createWorkspace({
    id: ws,
    seed: {
      'brand-voice.md': '# Brand voice\nProfessional, warm, concise.\n',
      'audience.md': '# Audience\nB2B founders and operators.\n',
      'items/2026-06-01-launch/post.md': '# Launch\nWe are live.\n',
    },
  });
  console.log(`seeded workspace "${ws}" at ${join(root, 'repos', ws)}`);
  console.log(`COMMONS_ROOT=${root}`);
};

main().catch((e) => { console.error(e); process.exit(1); });
