import type { Engine } from '../engine/types.js';
import type { WorkspaceSerializer } from '../util/serializer.js';

// The demo workspace every new tenant gets, so a first-time user can experience
// the whole propose -> review -> merge loop immediately, with NO agent run and
// NO token spend: we ship a populated workspace plus one proposal already
// waiting to be reviewed. The scenario is a small content-marketing "studio" —
// relatable to non-engineers and the diffs read as prose, not code.

export const ONBOARDING_WORKSPACE = 'welcome';

/** Files that make up the approved `main` state of the demo workspace. */
const SEED_FILES: Record<string, string> = {
  'README.md': `# 👋 Welcome to your Commons workspace

This is a **safe sandbox** that belongs only to you. Edit anything, break anything —
no one else can see it.

## What is Commons?

Commons is where AI agents **propose** changes to your work, and **you approve**
them. The one rule that never bends: **an agent can never merge.** Every change an
agent makes lands in a *proposal* you review first — like a pull request for any
kind of knowledge work, not just code.

\`\`\`
Agent drafts  ──▶  Proposal (you review the diff)  ──▶  You approve  ──▶  main
\`\`\`

## ▶️ Try it right now (30 seconds, no setup)

We left a **proposal waiting for you**. It's a draft launch-announcement post an
agent wrote against this workspace.

1. Open the **Proposals** panel — you'll see *"Draft: launch announcement + calendar update"*.
2. Click it to read the **diff**: one new blog post, plus a one-line update to the
   content calendar.
3. If you like it, hit **Approve**. Watch it merge into \`main\` — the post and the
   calendar update become part of your approved state.
4. Prefer to pass? Hit **Reject** and nothing changes. *You* are the gate.

That's the whole product. Everything else is detail.

## What's in this workspace

| File | What it is |
|------|------------|
| \`brand/voice.md\` | The tone an agent should write in |
| \`brand/audience.md\` | Who we're writing for |
| \`calendar.md\` | The editorial calendar |
| \`posts/\` | Published posts (approved, on \`main\`) |

Give an agent these as context and it proposes on-brand work. You stay in control.
`,

  'brand/voice.md': `# Brand voice

We sound like a sharp colleague, not a billboard.

- **Clear over clever.** Short sentences. Plain words. Cut the throat-clearing.
- **Concrete over abstract.** Show the thing happening, don't describe the category.
- **Warm, never gushing.** Confident and calm. No exclamation-mark confetti.
- **Honest about trade-offs.** We name the catch. Trust compounds.

**Avoid:** "revolutionary", "seamless", "game-changing", "unlock", "leverage" (verb),
"in today's fast-paced world".
`,

  'brand/audience.md': `# Audience

**Primary:** operators and founders at small teams who do real knowledge work —
writing, planning, research — and are curious about working *with* AI without
handing over the keys.

**They care about:** keeping control, moving faster, not babysitting tools.
**They distrust:** hype, black boxes, anything that acts without asking.

Write for the smart skeptic. Earn the click; never bait it.
`,

  'calendar.md': `# Editorial calendar

| Date | Title | Status |
|------|-------|--------|
| 2026-06-18 | Why a human approval gate beats "fully autonomous" | ✅ Published |
| 2026-06-25 | _open slot_ | 📝 Planned |

> Status legend: 📝 Planned · 🚧 In review (open proposal) · ✅ Published (merged to main)
`,

  'posts/2026-06-18-why-approval-gates-win.md': `# Why a human approval gate beats "fully autonomous"

The pitch for autonomous agents is seductive: set a goal, walk away, come back to
finished work. The reality is that "walk away" is exactly where trust breaks.

You can't review what you never saw. When an agent edits your work in place, you're
left auditing a finished result with no idea what changed or why. So you do one of
two things: rubber-stamp it, or redo it yourself. Neither is the dream.

There's a third option, and it's old as software: **propose, then merge.** The agent
does the work on a branch. You see a diff — exactly what changed, nothing hidden. You
approve, and only then does it become real. The agent moves fast; you stay the
decision-maker. No babysitting, no blind trust.

The catch worth naming: someone still has to review. That's the point. Review is
cheap when the diff is clean and you didn't write it. Redoing work is expensive.
Choosing what ships is the part you actually want to keep.
`,
};

/** The pending proposal: a draft post + a one-line calendar update. */
const PROPOSAL_TITLE = 'Draft: launch announcement + calendar update';

const PROPOSAL_POST_PATH = 'posts/2026-06-25-commons-launch.md';
const PROPOSAL_POST = `# Commons is open: let an agent draft, keep the final say

We built Commons on one conviction: AI should speed up your work without ever
taking it out of your hands.

Here's how a day looks. You point an agent at a workspace — your brand voice, your
audience, your calendar. It drafts. But nothing it writes touches your approved
state. Instead it opens a proposal: a clean diff you read in seconds. Approve and
it ships. Pass and it's gone. The agent never merges. You do.

The result is a strange kind of calm. You get the speed of automation and the
control of doing it yourself, without the tax of either — no rubber-stamping, no
redoing, no wondering what changed while you weren't looking.

Commons is open today. Bring a project, bring an agent, and keep the final say.
`;

const CALENDAR_AFTER = `# Editorial calendar

| Date | Title | Status |
|------|-------|--------|
| 2026-06-18 | Why a human approval gate beats "fully autonomous" | ✅ Published |
| 2026-06-25 | Commons is open: let an agent draft, keep the final say | 🚧 In review |

> Status legend: 📝 Planned · 🚧 In review (open proposal) · ✅ Published (merged to main)
`;

/**
 * Seed the demo workspace and one waiting proposal into a freshly-created
 * tenant's engine. Idempotent: skips if the workspace already exists. Mutations
 * go through the serializer to match every other write path in the app.
 */
export async function seedOnboarding(engine: Engine, serializer: WorkspaceSerializer): Promise<void> {
  const ws = ONBOARDING_WORKSPACE;
  const existing = await engine.listWorkspaces();
  if (existing.includes(ws)) return;

  await serializer.run(ws, async () => {
    await engine.createWorkspace({ id: ws, seed: SEED_FILES });

    const proposalId = 'launch-draft';
    await engine.createProposal(ws, { id: proposalId, title: PROPOSAL_TITLE });
    await engine.writeProposalFile(ws, proposalId, PROPOSAL_POST_PATH, PROPOSAL_POST);
    await engine.writeProposalFile(ws, proposalId, 'calendar.md', CALENDAR_AFTER);
    await engine.submitProposal(ws, proposalId, 'Draft launch announcement and slot it into the calendar');
  });
}
