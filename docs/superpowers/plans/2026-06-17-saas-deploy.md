# SaaS Step 7 — Deploy (portable artifacts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a portable container deployment for single-node Commons — Dockerfile, docker-compose (app + Caddy TLS + backup), a tested backup script, and DEPLOY.md — runnable on any VPS or Fly with no vendor lock-in.

**Architecture:** Multi-stage Docker image (Node 24, build the web SPA, ship `src/` run via `tsx` because the agent spawns child MCP from `.ts` files). docker-compose runs three services on one network: `app` (writes the persistent `/data` volume, never scaled >1 per ADR-1, no host ports), `caddy:2` (reverse proxy + automatic Let's Encrypt TLS, the only service publishing 80/443), and `backup` (a shell loop calling `scripts/backup.sh`). The backup script is the only piece with real logic, so it gets a vitest test; everything else is smoke-tested manually per DEPLOY.md.

**Tech Stack:** Docker, docker-compose, Caddy 2, Node 24, `tsx`, `node:sqlite`, `simple-git`/`git`, vitest, bash.

**Spec:** [docs/superpowers/specs/2026-06-17-saas-deploy-design.md](../specs/2026-06-17-saas-deploy-design.md)

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `package.json` | add production `start` script; move `tsx` to runtime deps | Modify |
| `scripts/backup.sh` | bundle each tenant repo + checkpoint/copy SQLite → timestamped tar.gz on the volume, prune, optional offsite push | Create |
| `test/backup.test.ts` | vitest coverage of `backup.sh` (archive, bundles, restore-verify, prune) | Create |
| `Dockerfile` | multi-stage image: build web SPA, ship runtime with git + tsx | Create |
| `.dockerignore` | keep build context small | Create |
| `docker-compose.yml` | app + caddy + backup services and named volumes | Create |
| `Caddyfile` | reverse-proxy `app:8787` with auto-TLS | Create |
| `.env.example` | document new deploy/backup env vars | Modify |
| `DEPLOY.md` | operator runbook (deploy, smoke-test, backup/restore, Fly note) | Create |
| `SAAS_BETA_ARCHITECTURE.md` | mark Step 7 ✅ | Modify |

---

### Task 1: Production start script and runtime `tsx`

**Why:** `npm run api` uses `node --watch` (dev). Production needs a non-watch entrypoint, and `tsx` must be a runtime dependency because the agent spawns the MCP child from `.ts` files ([src/agent/options.ts:68](../../../src/agent/options.ts#L68)).

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the `start` script**

In `package.json` `scripts`, add a `start` entry (place it right after the `api` line):

```json
    "api": "node --watch --import tsx src/api/main.ts",
    "start": "node --import tsx src/api/main.ts",
```

- [ ] **Step 2: Move `tsx` from devDependencies to dependencies**

Remove `"tsx": "^4.22.4"` from `devDependencies` and add it to `dependencies` (keep the same version). Resulting `dependencies` block keeps alphabetical-ish order; insert after `simple-git`:

```json
    "simple-git": "^3.36.0",
    "tsx": "^4.22.4",
    "zod": "^4.4.3"
```

And `devDependencies` no longer contains the `tsx` line.

- [ ] **Step 3: Verify the package.json is still valid JSON and the start script resolves**

Run: `node -e "require('./package.json')" && npm pkg get scripts.start`
Expected: prints `"node --import tsx src/api/main.ts"` with no JSON parse error.

- [ ] **Step 4: Verify install still resolves tsx as a dependency**

Run: `npm ls tsx`
Expected: `tsx@4.x` listed under `dependencies` (not `devDependencies`), no errors.

- [ ] **Step 5: Run the test suite to confirm nothing broke**

Run: `npm test`
Expected: all existing tests pass (171 at time of writing).

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "build(saas): add production start script, make tsx a runtime dependency"
```

---

### Task 2: Backup script (TDD)

**Why:** ADR-1 mandates daily local snapshots. The script is the only deploy artifact with real logic, so it is test-driven. It bundles each tenant git repo (`<root>/tenants/<tenant>/repos/<ws>`), checkpoints + copies the SQLite metadata DB, tars everything to `backups/<UTC-ts>.tar.gz` on the volume, prunes old archives, and optionally pushes offsite.

**Files:**
- Create: `scripts/backup.sh`
- Test: `test/backup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/backup.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, mkdir, readdir, writeFile, utimes, stat } from 'node:fs/promises';
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/backup.test.ts`
Expected: FAIL — `bash` cannot find `scripts/backup.sh` (ENOENT), because the script does not exist yet. (On Windows the suite is skipped — run this step in the Linux container or a bash-capable environment.)

- [ ] **Step 3: Write the backup script**

Create `scripts/backup.sh`:

```bash
#!/usr/bin/env bash
# Local snapshot of all Commons state on the persistent volume.
# Per ADR-1: git-on-disk + a single SQLite metadata DB. We bundle every tenant
# repo (a full --all git bundle is self-contained and restorable) and copy the
# DB after a WAL checkpoint, then tar everything to backups/<UTC-ts>.tar.gz.
set -euo pipefail

COMMONS_ROOT="${COMMONS_ROOT:-/data}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# 1. Bundle every tenant repo: <root>/tenants/<tenant>/repos/<ws>
shopt -s nullglob
for repo in "$COMMONS_ROOT"/tenants/*/repos/*; do
  [ -d "$repo" ] || continue
  git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || continue
  tenant="$(basename "$(dirname "$(dirname "$repo")")")"
  ws="$(basename "$repo")"
  git -C "$repo" bundle create "$staging/${tenant}__${ws}.bundle" --all
done

# 2. SQLite metadata DB: checkpoint WAL into the main file, then copy it.
db="$COMMONS_ROOT/commons.db"
if [ -f "$db" ]; then
  node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA wal_checkpoint(TRUNCATE)');d.close()" "$db"
  cp "$db" "$staging/commons.db"
fi

# 3. Archive to the volume.
mkdir -p "$COMMONS_ROOT/backups"
archive="$COMMONS_ROOT/backups/${ts}.tar.gz"
tar -czf "$archive" -C "$staging" .

# 4. Prune archives older than the retention window.
find "$COMMONS_ROOT/backups" -maxdepth 1 -name '*.tar.gz' -type f -mtime "+${BACKUP_KEEP_DAYS}" -delete

# 5. Optional offsite push. user@host:/path => scp; anything else => rclone remote.
#    A failed push warns but never fails the local snapshot.
if [ -n "$BACKUP_REMOTE" ]; then
  if [[ "$BACKUP_REMOTE" == *@*:* ]]; then
    if command -v scp >/dev/null 2>&1; then
      scp "$archive" "$BACKUP_REMOTE" || echo "warn: scp push to $BACKUP_REMOTE failed" >&2
    else
      echo "warn: BACKUP_REMOTE set but scp not installed" >&2
    fi
  else
    if command -v rclone >/dev/null 2>&1; then
      rclone copy "$archive" "$BACKUP_REMOTE" || echo "warn: rclone push to $BACKUP_REMOTE failed" >&2
    else
      echo "warn: BACKUP_REMOTE set but rclone not installed" >&2
    fi
  fi
fi

echo "backup ok: $archive"
```

- [ ] **Step 4: Make the script executable**

Run: `chmod +x scripts/backup.sh && git update-index --chmod=+x scripts/backup.sh 2>/dev/null || true`
Expected: no output; file is now executable (the git bit may not apply until staged — that is fine).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/backup.test.ts`
Expected: PASS — both tests green (or skipped on Windows). Run inside a bash-capable environment.

- [ ] **Step 6: Run the full suite for regressions**

Run: `npm test`
Expected: all tests pass (172 now — the new backup file adds tests where bash is available).

- [ ] **Step 7: Commit**

```bash
git add scripts/backup.sh test/backup.test.ts
git commit -m "feat(saas): tested backup script (git bundles + sqlite checkpoint)"
```

---

### Task 3: Dockerfile and .dockerignore

**Why:** Build a runnable image. Multi-stage: a build stage compiles the web SPA; the runtime stage installs `git` (engine uses `simple-git`), copies `node_modules` (now including `tsx`), `src`, the built `web/dist`, and runs as a non-root user with a healthcheck against the existing `/api/health` route ([src/api/server.ts](../../../src/api/server.ts), auth-exempt).

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

Create `.dockerignore`:

```
node_modules
data
.git
.gitignore
web/dist
.env
.env.*
docs
test
*.md
npm-debug.log*
```

- [ ] **Step 2: Write the `Dockerfile`**

Create `Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1

# --- build stage: install all deps and build the web SPA ---
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build:web

# --- runtime stage ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
# git is required by the engine (simple-git).
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# node_modules carries tsx (now a runtime dependency) — the agent spawns the
# MCP child from .ts files, so we run sources directly, no JS compile step.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
```

- [ ] **Step 3: Build the image**

Run: `docker build -t commons:local .`
Expected: build completes; final image tagged `commons:local`. (If Docker is unavailable in the dev environment, defer this verification to the deploy host and note it in the task handoff — do not skip it silently.)

- [ ] **Step 4: Smoke-test the container boots and serves health**

Run:
```bash
docker run --rm -d --name commons-smoke \
  -e COMMONS_AUTH_SECRET=smoke-secret-please-change \
  -e COMMONS_ROOT=/data -p 8787:8787 commons:local
sleep 5
curl -fsS http://127.0.0.1:8787/api/health
docker rm -f commons-smoke
```
Expected: `{"ok":true}` from the health endpoint, then the container is removed.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore
git commit -m "feat(saas): multi-stage Dockerfile (node 24 + git + tsx) and dockerignore"
```

---

### Task 4: docker-compose and Caddyfile

**Why:** Wire the runtime: `app` writes the persistent volume and is never exposed directly; `caddy` terminates TLS and reverse-proxies; `backup` runs the script on an interval. ADR-1: `app` must never scale beyond one replica on the shared volume.

**Files:**
- Create: `docker-compose.yml`
- Create: `Caddyfile`

- [ ] **Step 1: Write `Caddyfile`**

Create `Caddyfile`:

```
# COMMONS_DOMAIN drives automatic TLS. Use a real domain in production
# (Let's Encrypt); use `localhost` for a local smoke test (internal cert).
{$COMMONS_DOMAIN} {
	reverse_proxy app:8787
}
```

- [ ] **Step 2: Write `docker-compose.yml`**

Create `docker-compose.yml`:

```yaml
services:
  app:
    build: .
    env_file: .env
    environment:
      COMMONS_ROOT: /data
      HOST: 0.0.0.0
    volumes:
      - commons-data:/data
    restart: unless-stopped
    # ADR-1: SINGLE WRITER. The serializer is in-process and git locks are on
    # one volume. Do NOT add `deploy.replicas` or scale this service > 1.
    # No `ports:` — only Caddy is reachable from the host.

  caddy:
    image: caddy:2
    depends_on:
      - app
    ports:
      - "80:80"
      - "443:443"
    environment:
      COMMONS_DOMAIN: ${COMMONS_DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    restart: unless-stopped

  backup:
    build: .
    env_file: .env
    environment:
      COMMONS_ROOT: /data
    entrypoint: ["/bin/sh", "-c"]
    command:
      - 'while true; do /app/scripts/backup.sh || echo "backup run failed" >&2; sleep "${BACKUP_INTERVAL:-86400}"; done'
    volumes:
      - commons-data:/data
    restart: unless-stopped

volumes:
  commons-data:
  caddy_data:
  caddy_config:
```

- [ ] **Step 3: Validate the compose file parses**

Run: `docker compose config >/dev/null && echo OK`
Expected: `OK` (compose interpolates env; set `COMMONS_DOMAIN=localhost` in `.env` or export it first if it warns about an unset variable).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml Caddyfile
git commit -m "feat(saas): docker-compose (app + caddy TLS + backup) and Caddyfile"
```

---

### Task 5: Env documentation, DEPLOY.md, and architecture update

**Why:** Operators need the new env vars documented and a runbook. The architecture doc must record Step 7 as done.

**Files:**
- Modify: `.env.example`
- Create: `DEPLOY.md`
- Modify: `SAAS_BETA_ARCHITECTURE.md`

- [ ] **Step 1: Add deploy/backup vars to `.env.example`**

Append to the end of `.env.example` (the file already documents `GEMINI_API_KEY`, `COMMONS_AGENT_MODEL`, `COMMONS_IMAGE_MODEL`, `ANTHROPIC_API_KEY`, `COMMONS_ROOT`, `PORT` — do NOT duplicate those):

```
# --- Production deploy (docker compose) ---

# Domain Caddy will obtain TLS for. Use a real domain in production;
# 'localhost' for a local smoke test (internal cert).
# COMMONS_DOMAIN=commons.example.com

# Public origin, used for CORS and magic-link URLs. Must match the domain above.
# COMMONS_APP_URL=https://commons.example.com

# REQUIRED to start (added in step 3): session-signing + secret-encryption key.
# Generate with: openssl rand -hex 32
# COMMONS_AUTH_SECRET=

# Comma-separated invited emails (beta allowlist).
# COMMONS_INVITES=alice@example.com,bob@example.com

# Backup service tuning.
# BACKUP_KEEP_DAYS=7
# BACKUP_INTERVAL=86400          # seconds between backup runs
# BACKUP_REMOTE=                 # optional offsite: rclone 'remote:bucket/path' or scp 'user@host:/path'
```

- [ ] **Step 2: Write `DEPLOY.md`**

Create `DEPLOY.md`:

````markdown
# Deploying Commons (single-node)

Commons runs as a **single-writer node**: one `app` process owns the git-on-disk
state and the SQLite metadata DB on one persistent volume. **Never scale `app`
beyond one replica** (see ADR-1 in `SAAS_BETA_ARCHITECTURE.md`).

## Requirements

- A host with Docker + Docker Compose.
- A domain (A/AAAA record) pointing at the host, for automatic TLS.

## Deploy

1. Clone the repo on the host and copy the env template:

   ```bash
   cp .env.example .env
   ```

2. Fill in `.env` (uncomment and set):
   - `COMMONS_DOMAIN` — your domain (e.g. `commons.example.com`).
   - `COMMONS_APP_URL` — `https://<your-domain>`.
   - `COMMONS_AUTH_SECRET` — `openssl rand -hex 32`.
   - `ANTHROPIC_API_KEY` — required for the agent in production (pay-per-token).
   - `COMMONS_INVITES` — comma-separated invited emails.
   - Mailer vars (see step 3 setup) so magic links can be sent.

3. Bring it up:

   ```bash
   docker compose up -d --build
   ```

4. Verify health (through Caddy):

   ```bash
   curl -fsS https://<your-domain>/api/health
   ```
   Expect `{"ok":true}`.

## Smoke-test checklist (manual)

- [ ] `GET /api/health` returns `{"ok":true}` over HTTPS.
- [ ] The login page loads at `https://<your-domain>/`.
- [ ] Requesting a magic link for an invited email sends an email.
- [ ] Following the magic link signs in and the workspace list renders.
- [ ] An agent run produces a proposal (requires `ANTHROPIC_API_KEY`).

## Backup & restore

The `backup` service writes `/data/backups/<UTC-timestamp>.tar.gz` every
`BACKUP_INTERVAL` seconds and prunes archives older than `BACKUP_KEEP_DAYS`.
Each archive contains one `<tenant>__<workspace>.bundle` per repo plus
`commons.db`.

Run an ad-hoc backup:

```bash
docker compose exec backup /app/scripts/backup.sh
```

Restore a workspace from a bundle:

```bash
# Copy an archive off the volume and extract it:
docker compose cp backup:/data/backups/<ts>.tar.gz ./restore.tar.gz
mkdir restore && tar -xzf restore.tar.gz -C restore

# Recreate a repo from its bundle:
git clone restore/<tenant>__<workspace>.bundle <tenant>/<workspace>

# Restore the metadata DB by placing commons.db back at <COMMONS_ROOT>/commons.db
# (stop the app first so it is not mid-write).
```

Optional offsite copies: set `BACKUP_REMOTE` to an `rclone` remote
(`remote:bucket/path`) or an scp target (`user@host:/path`).

## Upgrading to Fly.io (optional)

The same `Dockerfile` works on Fly. Use a `fly.toml` with **one** instance
(`min_machines_running = 1`, no autoscaling) and a Fly Volume mounted at `/data`.
Fly terminates TLS for you, so the `caddy` service can be dropped. A `fly.toml`
is intentionally not included in this step.
````

- [ ] **Step 3: Mark Step 7 done in the architecture doc**

In `SAAS_BETA_ARCHITECTURE.md`, find the "Bước 7" / deploy line and mark it ✅ with a one-line summary. Locate the step heading (search for `Bước 7` or `Deploy`) and update it to read:

```
- [x] **Bước 7 — Deploy** ✅ Artifacts: `Dockerfile`, `docker-compose.yml` (app + Caddy TLS + backup), `Caddyfile`, `scripts/backup.sh` (tested), `DEPLOY.md`. Portable VPS/Fly, single-node (ADR-1).
```

If the existing line uses a different format, preserve that format and just add the ✅ + summary.

- [ ] **Step 4: Verify the full suite still passes**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add .env.example DEPLOY.md SAAS_BETA_ARCHITECTURE.md
git commit -m "docs(saas): deploy env vars, DEPLOY runbook, mark step 7 done"
```

---

## Final verification

- [ ] **Run the complete suite once more:** `npm test` → all green.
- [ ] **Confirm no merge/discard tool was added to the MCP layer** (invariant): `grep -rn "merge\|discard" src/mcp/tools.ts` → only unrelated matches, no new tool.
- [ ] **Confirm `app` has no `ports:` in compose** (ADR-6): the only published ports are Caddy's 80/443.
- [ ] Hand off to **superpowers:finishing-a-development-branch**.
