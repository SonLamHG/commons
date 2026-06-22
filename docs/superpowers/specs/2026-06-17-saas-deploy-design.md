# SaaS Bước 7 — Deploy (portable artifacts) — Thiết kế

> Trạng thái: **ĐÃ DUYỆT thiết kế** (chờ review spec). Ngày: 2026-06-17.
> Đọc kèm: [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md) (ADR-1, ADR-6), [CLAUDE.md](../../../CLAUDE.md).

## Mục tiêu

Sinh bộ artifacts container hoá để đưa **Commons single-node** lên **bất kỳ VPS/Fly nào**:
reverse proxy + TLS tự động, backup hằng ngày, healthcheck — **không khoá nhà cung cấp**.
Không thay đổi hành vi runtime của ứng dụng; chỉ thêm hạ tầng đóng gói + vận hành tối thiểu.

## Ràng buộc cứng (rút từ codebase + ADR)

- **Single instance bắt buộc** (ADR-1): serializer in-memory một-process + git-on-disk. Compose
  **không bao giờ** scale service `app` >1 trên cùng volume.
- **Node 24** base image: DB dùng `node:sqlite` (`DatabaseSync`, [src/db/index.ts:1](../../../src/db/index.ts#L1)),
  experimental — cần Node ≥22.5; chọn 24 cho ổn định.
- **git phải có trong image**: engine dùng `simple-git`.
- **Giữ `tsx` ở production**: agent spawn child MCP bằng `npx tsx .../mcp/stdio.ts` trỏ thẳng
  file `.ts` ([src/agent/options.ts:68](../../../src/agent/options.ts#L68)). Compile sang JS sẽ phá
  child-spawn + quy ước "không build step cho `src/`". → `tsx` chuyển từ devDependencies sang
  dependencies; chỉ build web SPA.
- **ADR-6 "sau reverse proxy"**: trong container, `app` bind `0.0.0.0` nhưng **không publish port
  ra host**; chỉ Caddy expose 80/443. `trustProxy: true` đã bật ở bước 4 → `req.ip` đúng.
- **Backup bắt buộc** (ADR-1): local snapshot hằng ngày + hook push offsite tuỳ chọn.

## Files sinh ra

### 1. `package.json` (sửa)
- Thêm script: `"start": "node --import tsx src/api/main.ts"` (bỏ `--watch`).
- Chuyển `"tsx"` từ `devDependencies` sang `dependencies` (giữ nguyên version `^4.22.4`).

### 2. `Dockerfile` (tạo)
Multi-stage:
- **Stage `build`** (`node:24-slim`): `npm ci`, `npm run build:web` → sinh `web/dist`.
- **Stage runtime** (`node:24-slim`):
  - `apt-get install -y --no-install-recommends git` rồi dọn apt lists.
  - Copy `node_modules`, `src`, `web/dist`, `package.json`, `tsconfig.json` từ stage build
    (node_modules đã chứa `tsx` vì nay là dependency).
  - `USER node` (không chạy root).
  - `HEALTHCHECK` gọi `/api/health` bằng node one-liner (tránh cài curl/wget):
    `node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`.
  - `CMD ["npm","start"]`.

### 3. `.dockerignore` (tạo)
`node_modules`, `data`, `.git`, `web/dist`, `.env`, `docs`, `test`, `*.md` (giữ image gọn; web/dist
được rebuild trong stage build).

### 4. `docker-compose.yml` (tạo)
Ba service, một network mặc định:
- **`app`**: `build: .`, `env_file: .env`, `environment: COMMONS_ROOT=/data, HOST=0.0.0.0`,
  `volumes: [commons-data:/data]`, `restart: unless-stopped`, **không** có `ports:` (không expose ra host).
  Comment cảnh báo: KHÔNG đặt `deploy.replicas` / không scale >1 (ADR-1).
- **`caddy`**: `image: caddy:2`, `ports: ["80:80","443:443"]`, mount `./Caddyfile:/etc/caddy/Caddyfile:ro`
  + volumes `caddy_data:/data`, `caddy_config:/config`, `depends_on: [app]`, `restart: unless-stopped`.
- **`backup`**: dùng cùng image build (`build: .`), `entrypoint` vòng lặp shell gọi `scripts/backup.sh`
  mỗi `BACKUP_INTERVAL` (mặc định 86400s), `volumes: [commons-data:/data]`, `env_file: .env`,
  `restart: unless-stopped`. (Service-cron portable cả trên Fly; không phụ thuộc host cron.)
- Volumes: `commons-data`, `caddy_data`, `caddy_config`.

### 5. `Caddyfile` (tạo)
```
{$COMMONS_DOMAIN} {
	reverse_proxy app:8787
}
```
Caddy tự cấp TLS qua Let's Encrypt khi `COMMONS_DOMAIN` là domain thật; với `localhost` Caddy cấp
cert nội bộ để smoke-test.

### 6. `scripts/backup.sh` (tạo) — **phần có logic thật, được test**
Đầu vào qua env: `COMMONS_ROOT` (mặc định `/data`), `BACKUP_KEEP_DAYS` (mặc định 7),
`BACKUP_REMOTE` (tuỳ chọn). Hành vi:
1. `set -euo pipefail`; tạo thư mục tạm staging.
2. Với mỗi tenant repo dưới `$COMMONS_ROOT/*/repos/*` (là git repo): `git bundle create
   <staging>/<tenant>__<ws>.bundle --all`.
3. SQLite: nếu `$COMMONS_ROOT/commons.db` tồn tại → `sqlite`/node checkpoint rồi copy. Vì image
   không có sqlite3 CLI, dùng node one-liner:
   `node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('PRAGMA wal_checkpoint(TRUNCATE)');d.close()" "$DB"`
   rồi `cp` file `.db` (đủ vì WAL đã checkpoint).
4. `tar -czf $COMMONS_ROOT/backups/<UTC-timestamp>.tar.gz -C <staging> .`.
5. Prune: xoá `*.tar.gz` trong `backups/` cũ hơn `BACKUP_KEEP_DAYS` ngày.
6. Nếu `BACKUP_REMOTE` set: `rclone copy` hoặc `scp` tarball mới nhất (lệnh chọn theo prefix của
   `BACKUP_REMOTE`; nếu công cụ thiếu → cảnh báo stderr, không làm hỏng backup local).
7. In dòng tóm tắt ra stdout; exit 0 khi local snapshot thành công.

### 7. `.env.example` (sửa)
Thêm, kèm chú thích:
```
# Production deploy (docker compose)
# COMMONS_DOMAIN=commons.example.com     # domain Caddy cấp TLS; 'localhost' để test local
# COMMONS_APP_URL=https://commons.example.com  # origin dùng cho CORS + magic-link
# COMMONS_AUTH_SECRET=                    # BẮT BUỘC (đã có ở bước 3) — khoá ký session + mã hoá secret
# ANTHROPIC_API_KEY=                      # BẮT BUỘC ở prod cho agent (pay-per-token)
# BACKUP_KEEP_DAYS=7
# BACKUP_INTERVAL=86400                   # giây giữa hai lần backup (service backup)
# BACKUP_REMOTE=                          # tuỳ chọn: rclone remote (vd remote:bucket/path) hoặc user@host:/path (scp)
```

### 8. `DEPLOY.md` (tạo)
- **Yêu cầu**: Docker + Docker Compose; một domain trỏ vào máy (cho TLS thật).
- **Các bước**: copy `.env.example`→`.env`, điền `COMMONS_DOMAIN`/`COMMONS_APP_URL`/
  `COMMONS_AUTH_SECRET`/`ANTHROPIC_API_KEY`/`COMMONS_INVITES`; `docker compose up -d --build`;
  verify `curl -fsS https://<domain>/api/health`.
- **Smoke-test checklist** (thủ công): health 200; trang login load; magic-link gửi được;
  agent run chạy (cần ANTHROPIC_API_KEY).
- **Backup/restore**: vị trí `/data/backups`; cách restore (giải nén tarball, `git clone`/`fetch`
  từ bundle, đặt lại `commons.db`).
- **Single-node**: cảnh báo rõ KHÔNG scale `app`.
- **Đường nâng cấp Fly** (ghi chú ngắn): dùng cùng Dockerfile; `fly.toml` 1 instance + Fly Volume
  mount `/data`; Fly lo TLS nên có thể bỏ service `caddy`. (Không sinh `fly.toml` ở bước này.)

## Testing

- **`test/backup.test.ts`** (vitest): dựng một `COMMONS_ROOT` tạm (`mkdtemp`) với 1–2 tenant repo
  git thật (init + commit một file) và một `commons.db` thật (qua `createDb`). Chạy `scripts/backup.sh`
  qua `execFile` với env trỏ vào thư mục tạm. Assert:
  - tarball xuất hiện trong `backups/`;
  - giải nén ra có `.bundle` cho mỗi tenant repo và file `commons.db`;
  - `git bundle verify` trên bundle pass (repo phục hồi được);
  - prune: tạo một tarball giả cũ (mtime quá hạn) → sau khi chạy bị xoá; tarball mới còn.
  - Bỏ qua/skip có điều kiện trên Windows nếu không có `bash` (script chạy trong container Linux;
    test chỉ chạy nơi có `bash`). Dùng `test.skipIf(process.platform==='win32')` để CI Linux phủ.
- **Dockerfile/compose/Caddy**: smoke-test thủ công theo checklist DEPLOY.md; **không** tự động CI
  ở bước này (YAGNI cho beta; CI/Ops là bước 8).
- **Hồi quy**: 171 test hiện có phải vẫn xanh (chỉ thêm file + đổi script `start`, không sửa hành vi).

## Cập nhật tài liệu

- `SAAS_BETA_ARCHITECTURE.md`: đánh dấu Bước 7 ✅ với tóm tắt artifacts đã sinh.

## Phạm vi loại trừ (cố ý — YAGNI cho beta)

- Không sinh `fly.toml` (chỉ ghi chú đường nâng cấp).
- Không CI pipeline / không tự build image trong CI (bước 8).
- Không logging có cấu trúc / error tracking / drift-repair (bước 8).
- Không multi-node, không scale ngang (Direction B).
