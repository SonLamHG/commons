/**
 * Real-run benchmark for the Commons drafting agent. Drives the actual agent
 * (real Anthropic API) against an existing workspace under COMMONS_ROOT (./data),
 * scores each run, writes per-turn NDJSON traces, and cleans up created proposals.
 *
 * Usage (--target, NOT --workspace/--ws: npm prefix-matches those to its own
 * reserved --workspace flag and swallows them before the script sees them):
 *   npm run bench:agent -- --target content-calendar --runs 10
 *   npm run bench:agent -- --target content-calendar --runs 3 --keep
 *   npm run bench:agent -- --target content-calendar --prompt "..."
 * (Direct tsx also accepts --ws / --workspace:
 *   npx tsx src/bench/agent-bench.ts --workspace content-calendar --runs 10)
 */
import { join } from 'node:path';
import { loadEnv } from '../util/env.js';
import { createEngine } from '../engine/index.js';

loadEnv(); // make ANTHROPIC_API_KEY / COMMONS_ROOT from .env available (entry-point convention)
import { createClaudeRunner } from '../agent/runner.js';
import { scoreRun, type RunScore } from './score.js';
import type { AgentEvent } from '../agent/types.js';

const DEFAULT_PROMPT = 'Viết một bài LinkedIn ngắn giới thiệu tính năng review UI mới của Commons.';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  // --target is the documented flag (npm prefix-matches --ws/--workspace to its own
  // reserved flag); accept --ws/--workspace too for direct `tsx` invocation.
  const workspace = arg('target') ?? arg('ws') ?? arg('workspace');
  if (!workspace) { console.error('error: --target <workspace-id> is required'); process.exit(1); }
  const runs = Number(arg('runs', '10'));
  const prompt = arg('prompt', DEFAULT_PROMPT)!;
  const keep = hasFlag('keep');

  const root = process.env.COMMONS_ROOT ?? join(process.cwd(), 'data');
  // Token traces for this benchmark land here (read by createClaudeRunner via env).
  process.env.COMMONS_TRACE_DIR = join(root, 'traces', 'bench');

  const engine = createEngine(root);
  const runner = createClaudeRunner();
  const results: Array<{ score: RunScore; numTurns: number; costUsd: number }> = [];

  for (let i = 1; i <= runs; i++) {
    const before = new Set((await engine.listProposals(workspace)).map((p) => p.id));
    const events: AgentEvent[] = [];
    const res = await runner.run(root, workspace, prompt, (e) => events.push(e));

    const fresh = (await engine.listProposals(workspace)).filter((p) => !before.has(p.id));
    const newProposals = await Promise.all(
      fresh.map(async (p) => ({ status: p.status, diffs: await engine.diffProposal(workspace, p.id) })),
    );
    const score = scoreRun({ workspace, events, newProposals });
    results.push({ score, numTurns: res.numTurns, costUsd: res.costUsd });

    const flags = [
      score.proposal ? 'P' : '·',
      score.firstCall ? 'F' : '·',
      score.noStrayTools ? 'S' : '·',
      score.rightWorkspace ? 'W' : '·',
    ].join('');
    console.log(
      `run ${String(i).padStart(2)}: ${score.pass ? 'PASS' : 'FAIL'} [${flags}] ` +
      `turns=${res.numTurns} cost=$${res.costUsd.toFixed(4)}`,
    );

    if (!keep) {
      for (const p of fresh) {
        try { await engine.discardProposal(workspace, p.id); }
        catch (e) { console.error(`  cleanup failed for ${p.id}: ${e instanceof Error ? e.message : e}`); }
      }
    }
  }

  const n = results.length;
  const rate = (sel: (s: RunScore) => boolean) =>
    `${results.filter((r) => sel(r.score)).length}/${n}`;
  const costs = results.map((r) => r.costUsd);
  const totalCost = costs.reduce((a, b) => a + b, 0);
  console.log('\n── aggregate ──');
  console.log(`pass:            ${rate((s) => s.pass)}`);
  console.log(`proposal:        ${rate((s) => s.proposal)}`);
  console.log(`firstCall:       ${rate((s) => s.firstCall)}`);
  console.log(`noStrayTools:    ${rate((s) => s.noStrayTools)}`);
  console.log(`rightWorkspace:  ${rate((s) => s.rightWorkspace)}`);
  console.log(`mean cost/run:   $${(totalCost / n).toFixed(4)}`);
  console.log(`total spend:     $${totalCost.toFixed(4)}`);
  console.log(`traces:          ${process.env.COMMONS_TRACE_DIR}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
