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
