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
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth client credentials.
     Register the redirect URI `https://<your-domain>/api/auth/google/callback`
     in the Google Cloud Console.

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
- [ ] Clicking "Đăng nhập với Google" redirects to the Google consent screen.
- [ ] Completing Google sign-in returns to the app and the workspace list renders.
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
