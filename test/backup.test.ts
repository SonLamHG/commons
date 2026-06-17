import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, readdir, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDb } from '../src/db/index.js';

const exec = promisify(execFile);
const SCRIPT = resolve(__dirname, '../scripts/backup.sh');

// backup.sh is a bash script meant to run inside the Linux container.
// Run it only where bash exists; skip on bare Windows CI.
const runBackup = (root: string, env: Record<string, string> = {}) =>
  exec('bash', [SCRIPT], { env: { ...process.env, COMMONS_ROOT: root, ...env } });

// Initialise a git repo at <root>/tenants/<tenant>/repos/<ws> with one commit.
async function makeTenantRepo(root: string, tenant: string, ws: string): Promise<string> {
  const repo = join(root, 'tenants', tenant, 'repos', ws);
  await mkdir(repo, { recursive: true });
  const git = (args: string[]) => exec('git', args, { cwd: repo });
  await git(['init', '-q']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'README.md'), `# ${ws}\n`);
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'init']);
  return repo;
}

describe.skipIf(process.platform === 'win32')('backup.sh', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'commons-backup-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('archives tenant repos and the sqlite db into a timestamped tarball', async () => {
    await makeTenantRepo(root, 'acme', 'ws1');
    await makeTenantRepo(root, 'globex', 'ws2');
    const db = createDb(join(root, 'commons.db'));
    db.createTenant('acme');

    await runBackup(root);

    const archives = (await readdir(join(root, 'backups'))).filter((f) => f.endsWith('.tar.gz'));
    expect(archives).toHaveLength(1);

    // Extract and inspect contents.
    const out = await mkdtemp(join(tmpdir(), 'commons-extract-'));
    await exec('tar', ['-xzf', join(root, 'backups', archives[0]), '-C', out]);
    const files = await readdir(out);
    expect(files).toContain('acme__ws1.bundle');
    expect(files).toContain('globex__ws2.bundle');
    expect(files).toContain('commons.db');

    // A bundle must be a valid, restorable git repo.
    await exec('git', ['bundle', 'verify', join(out, 'acme__ws1.bundle')]);

    await rm(out, { recursive: true, force: true });
  });

  it('prunes archives older than BACKUP_KEEP_DAYS but keeps fresh ones', async () => {
    await makeTenantRepo(root, 'acme', 'ws1');
    await mkdir(join(root, 'backups'), { recursive: true });
    const stale = join(root, 'backups', 'stale.tar.gz');
    await writeFile(stale, 'old');
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    await utimes(stale, tenDaysAgo, tenDaysAgo);

    await runBackup(root, { BACKUP_KEEP_DAYS: '7' });

    expect(existsSync(stale)).toBe(false); // pruned
    const archives = (await readdir(join(root, 'backups'))).filter((f) => f.endsWith('.tar.gz'));
    expect(archives.length).toBeGreaterThanOrEqual(1); // the fresh one survives
  });
});
