import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/engine/index.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { generateId } from '../src/util/id.js';
import { createTools } from '../src/mcp/tools.js';
import type { ImageGenerator } from '../src/image/types.js';

describe('generate_image tool', () => {
  let root: string;
  let tools: ReturnType<typeof createTools>;

  const fakeGen: ImageGenerator = {
    async generate() {
      return { bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mime: 'image/png' };
    },
  };

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'commons-tools-'));
    const engine = createEngine(root);
    tools = createTools({ engine, serializer: new WorkspaceSerializer(), genId: generateId, imageGenerator: fakeGen });
    await engine.createWorkspace({ id: 'ws', seed: { 'README.md': '# x\n' } });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('writes the generated image into the proposal worktree', async () => {
    const createTool = tools.find((t) => t.name === 'create_proposal')!;
    const id = await createTool.run({ workspace: 'ws', title: 'img' });
    const gen = tools.find((t) => t.name === 'generate_image')!;
    const out = await gen.run({ workspace: 'ws', proposalId: id, prompt: 'a cat', path: 'assets/cat.png' });
    expect(out).toContain('assets/cat.png');

    // commit the changes so diff_proposal can see them
    const submitTool = tools.find((t) => t.name === 'submit_proposal')!;
    await submitTool.run({ workspace: 'ws', proposalId: id, message: 'add image' });

    const diffTool = tools.find((t) => t.name === 'diff_proposal')!;
    const diff = await diffTool.run({ workspace: 'ws', proposalId: id });
    expect(diff).toContain('assets/cat.png');
  });
});
