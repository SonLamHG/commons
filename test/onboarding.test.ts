import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEngine } from '../src/engine/index.js';
import type { Engine } from '../src/engine/types.js';
import { WorkspaceSerializer } from '../src/util/serializer.js';
import { seedOnboarding, ONBOARDING_WORKSPACE } from '../src/onboarding/seed.js';

let root: string;
let engine: Engine;
let serializer: WorkspaceSerializer;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'commons-onboard-'));
  engine = createEngine(root);
  serializer = new WorkspaceSerializer();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('seedOnboarding', () => {
  it('creates the demo workspace with content and one waiting proposal', async () => {
    await seedOnboarding(engine, serializer);

    expect(await engine.listWorkspaces()).toContain(ONBOARDING_WORKSPACE);

    const paths = (await engine.readState(ONBOARDING_WORKSPACE))
      .filter((n) => n.type === 'file').map((n) => n.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('calendar.md');

    const proposals = await engine.listProposals(ONBOARDING_WORKSPACE);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].status).toBe('submitted');

    // The diff shows the draft post added and the calendar modified — the
    // exact "wow" a first-time reviewer sees.
    const diff = await engine.diffProposal(ONBOARDING_WORKSPACE, proposals[0].id);
    const byPath = Object.fromEntries(diff.map((d) => [d.path, d.status]));
    expect(byPath['posts/2026-06-25-commons-launch.md']).toBe('added');
    expect(byPath['calendar.md']).toBe('modified');
  });

  it('is idempotent: a second run does not duplicate the workspace or proposal', async () => {
    await seedOnboarding(engine, serializer);
    await seedOnboarding(engine, serializer);

    const proposals = await engine.listProposals(ONBOARDING_WORKSPACE);
    expect(proposals).toHaveLength(1);
  });

  it('produces a proposal that merges cleanly into main', async () => {
    await seedOnboarding(engine, serializer);
    const [proposal] = await engine.listProposals(ONBOARDING_WORKSPACE);

    const result = await engine.mergeProposal(ONBOARDING_WORKSPACE, proposal.id);
    expect(result.merged).toBe(true);

    const paths = (await engine.readState(ONBOARDING_WORKSPACE))
      .filter((n) => n.type === 'file').map((n) => n.path);
    expect(paths).toContain('posts/2026-06-25-commons-launch.md');
  });
});
