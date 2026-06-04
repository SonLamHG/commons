import { createEngine } from '../src/engine/index.js';
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(process.cwd(), 'data', 'demo');
if (existsSync(root)) rmSync(root, { recursive: true, force: true });

const engine = createEngine(root);
const files = async (ws: string) =>
  (await engine.readState(ws)).filter((n) => n.type === 'file').map((n) => n.path);
const hr = (t: string) => console.log('\n' + '─'.repeat(64) + '\n' + t + '\n' + '─'.repeat(64));

const main = async () => {
  hr('1. Tao workspace "content-calendar" (durable state ban dau)');
  await engine.createWorkspace({
    id: 'content-calendar',
    seed: {
      'brand-voice.md': '# Brand voice\nProfessional, warm.\n',
      'items/2026-06-01-launch/post.md': '# Launch post\nWe are live.\n',
    },
  });
  console.log('main files:', await files('content-calendar'));

  hr('2. Agent mo proposal "draft-w22" (worktree CO LAP) + viet drafts');
  await engine.createProposal('content-calendar', { id: 'draft-w22', title: 'Draft week 22' });
  await engine.writeProposalFile('content-calendar', 'draft-w22', 'items/2026-06-08-tips/post.md', '# 5 tips\nHere are 5 tips.\n');
  await engine.writeProposalFile('content-calendar', 'draft-w22', 'brand-voice.md', '# Brand voice\nProfessional, warm, and a bit playful.\n');
  await engine.submitProposal('content-calendar', 'draft-w22', 'draft week 22');
  console.log('proposals:', (await engine.listProposals('content-calendar')).map((p) => `${p.id}=${p.status}`));

  hr('3. ISOLATION: main CHUA doi (drafts khong nam trong main)');
  console.log('main files:', await files('content-calendar'), '  <- van chua co tips post');

  hr('4. REVIEW SURFACE: diff agent de xuat (human se duyet cai nay)');
  for (const d of await engine.diffProposal('content-calendar', 'draft-w22')) {
    console.log(`\n[${d.status.toUpperCase()}] ${d.path}`);
    console.log(d.diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^[+-]{3}/.test(l)).join('\n'));
  }

  hr('5. Human APPROVE -> merge vao main');
  console.log('merge:', await engine.mergeProposal('content-calendar', 'draft-w22'));
  console.log('main files now:', await files('content-calendar'));
  console.log('brand-voice.md now:\n' + (await engine.readFile('content-calendar', 'brand-voice.md')));

  hr('6. CONFLICT demo: 2 proposal cung sua brand-voice.md');
  for (const [id, body] of [['edit-a', 'VERSION A'], ['edit-b', 'VERSION B']] as const) {
    await engine.createProposal('content-calendar', { id, title: id });
    await engine.writeProposalFile('content-calendar', id, 'brand-voice.md', `# Brand voice\n${body}\n`);
    await engine.submitProposal('content-calendar', id, `${id} edits voice`);
  }
  console.log('merge edit-a:', await engine.mergeProposal('content-calendar', 'edit-a'));
  console.log('merge edit-b:', await engine.mergeProposal('content-calendar', 'edit-b'), ' <- CONFLICT, main untouched');
  console.log('brand-voice.md still:\n' + (await engine.readFile('content-calendar', 'brand-voice.md')));

  hr('Xong. Inspect git that: data/demo/repos/content-calendar (git log --all)');
};
main().catch((e) => { console.error(e); process.exit(1); });
