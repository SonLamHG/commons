# SAAS_BETA_ARCHITECTURE — ADR cho bản beta mời (invite-only, free)

> Trạng thái: **ĐỀ XUẤT** (chờ duyệt). Ngày: 2026-06-16.
> Mục tiêu sản phẩm: đưa Commons cho **người dùng thật được mời**, **miễn phí**, để
> **đo mức độ hài lòng** trước khi đầu tư vào billing. Mọi quyết định dưới đây tối ưu
> cho mục tiêu đó — *học nhanh, hạ tầng tối thiểu, vẫn an toàn về dữ liệu và chi phí*.
>
> Đọc kèm: [CLAUDE.md](CLAUDE.md), [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md), [FINDINGS.md](FINDINGS.md).

## Nguyên tắc dẫn đường

1. **Giữ git-engine làm lõi.** Bất biến "agent đề xuất, người merge" là điểm khác biệt sản
   phẩm. Không rewrite sang DB. Mọi thứ SaaS xây *bao quanh* engine, không thay engine.
2. **Free ≠ bỏ kiểm soát chi phí.** Gác *billing* (thu tiền), nhưng *cost-cap* và *đo
   usage* là bắt buộc — nếu không, một user có thể đốt sạch hóa đơn token của ta.
3. **Beta mời = thu nhỏ phạm vi.** Kiểm soát ai vào → giảm mạnh nhu cầu chống-bot, scale,
   pháp lý. Đủ để lấy tín hiệu hài lòng.
4. **Mọi quyết định chừa đường nâng cấp** (Direction B: multi-node) qua các interface/seam,
   nhưng *không* xây sẵn.

---

## ADR-1 — Mô hình lưu trữ & triển khai: **single-writer node + persistent volume**

**Quyết định.** Triển khai Commons như **một node trạng thái duy nhất** (single writer),
gắn **persistent volume** mount vào `COMMONS_ROOT`. Giữ nguyên git-engine.

**Vì sao.**
- State hiện là git-on-disk + serializer in-memory một-instance
  ([KNOWN_LIMITATIONS #1b](KNOWN_LIMITATIONS.md)). Đúng một process ghi → serializer vẫn
  hợp lệ, không cần distributed lock.
- `createEngine(rootDir)` đã nhận root làm tham số ([engine/index.ts:9](src/engine/index.ts#L9))
  → tách tenant theo thư mục là thay đổi nhỏ (xem ADR-2).

**Hệ quả / ràng buộc cứng.**
- **Chỉ chạy 1 instance API (writer).** Scale lên >1 instance trên cùng volume = hỏng git.
  Đây là trần của Direction A; vượt trần → chuyển Direction B (ngoài phạm vi beta).
- **Nền tảng deploy phải có FS bền + tiến trình chạy dài.** Chọn **Fly.io (Fly Volume)**
  hoặc **VPS (Hetzner/DO) + block volume + Docker + Caddy**. **KHÔNG** dùng
  Vercel/Netlify/Cloudflare Workers (FS ephemeral, không process dài → mất dữ liệu mỗi deploy).
- **Backup bắt buộc.** Cron hằng ngày: snapshot volume **và** `git bundle`/push-mirror mỗi
  repo tenant ra remote dự phòng (S3/git host). Mất đĩa không được = mất việc đã duyệt.

**Phương án loại bỏ.**
- *Serverless + DB rewrite*: phá bỏ git-invariant, rewrite khổng lồ. Loại.
- *Multi-node ngay từ beta*: cần distributed lock + sandbox per-run; quá sức cho mục tiêu học.

---

## ADR-2 — Đa tenant: **tenant = thư mục gốc riêng, một engine instance / tenant**

**Quyết định.** Mỗi tenant có subtree riêng: `COMMONS_ROOT/<tenantId>/{repos,worktrees,meta}`.
Resolve engine theo tenant: `createEngine(join(COMMONS_ROOT, tenantId))`. Beta: **1 tenant =
1 user được mời** (đơn giản hoá tối đa; org/nhiều-thành-viên để sau).

**Vì sao.**
- Tái dùng **100%** logic engine (path-safety, conflict, Windows paths) mà không đụng vào nó.
- **Cô lập filesystem mạnh**: tenant A không thể truy cập subtree tenant B (kể cả nếu lỗi
  path) vì root khác nhau.

**Hệ quả.**
- **Serializer phải key theo tenant + workspace** (`${tenantId}:${ws}`) để khóa của tenant
  này không chặn nhầm tenant khác. Vẫn một `WorkspaceSerializer` dùng chung trong process.
- Cần **registry** ánh xạ user → tenant, danh sách workspace thuộc tenant. Lưu ở **SQLite**
  trên volume (xem ADR-7), không nhét vào git.
- Mọi route API phải resolve tenant từ session **trước**, rồi mới gọi engine của tenant đó —
  thay cho việc nhận `:ws` toàn cục như hiện tại ([api/server.ts](src/api/server.ts)).

**Phương án loại bỏ.** Nhúng tenantId vào workspace-id (phải parse chuỗi, dễ rò rỉ cross-tenant). Loại.

---

## ADR-3 — Xác thực: **invite-only, passwordless (magic-link) + allowlist**

**Quyết định.** Không có đăng ký mở. Chỉ **email trong allowlist mời** mới đăng nhập được, qua
**magic-link** (passwordless). Phiên = cookie ký, `httpOnly`, `Secure`, `SameSite=Lax`.

**Vì sao.** Auth là thứ dễ làm sai tinh vi nhất; beta mời cho phép dùng cơ chế tối giản, an toàn.

**Lựa chọn triển khai (chọn 1 khi build).**
- *Khuyến nghị beta:* dịch vụ quản lý — **Supabase Auth** hoặc **Clerk** (free tier đủ cho
  beta nhỏ, lo sẵn magic-link/email/session). Bọc sau một adapter mỏng để swap được.
- *Tự host:* **Lucia + mailer (Resend/Postmark)** nếu muốn không phụ thuộc bên thứ ba.

**Hệ quả.**
- Bảng `invites(email, invited_at, accepted_at)` + `users(id, email, tenant_id, created_at)`.
- Login chỉ thành công nếu email ∈ invites. Lần đầu thành công → tạo tenant + user + seed
  workspace mẫu.
- Middleware `requireAuth` gắn `{userId, tenantId}` vào request; mọi route `/api/*` (trừ
  health) đi qua nó.

---

## ADR-4 — Agent run: **tách khỏi request, hàng đợi in-process có giới hạn + trạng thái bền**

**Quyết định.** Không chạy agent inline trong vòng đời HTTP như hiện tại
([api/server.ts:257](src/api/server.ts#L257)). Đưa vào **hàng đợi in-process** (cùng node)
với **giới hạn đồng thời**, và **lưu trạng thái run** vào SQLite để UI poll/resume sau khi
reconnect hoặc sau restart.

**Vì sao.** Hiện restart = mất run, không cancel được ([KNOWN_LIMITATIONS #5](KNOWN_LIMITATIONS.md)).
Beta single-node chưa cần Redis/BullMQ; hàng đợi in-process + bảng run-state là đủ.

**Hệ quả.**
- Bảng `runs(id, user_id, tenant_id, workspace, status, cost_usd, num_turns, model, created_at, finished_at)`.
  `costUsd`/`numTurns` đã có sẵn từ event `done` ([agent/events.ts:37](src/agent/events.ts#L37)).
- Giữ seam `AgentRunner` ([agent/types.ts](src/agent/types.ts)) — chỉ bọc thêm queue + persistence.
- Trần đồng thời: **1 run/user**, **2–3 run/toàn hệ thống** (mỗi run spawn 1 child `tsx` MCP
  — [agent/options.ts:64](src/agent/options.ts#L64) — nên chặn để không fork-bomb).
- Cancel: cho phép hủy run đang chạy (đóng iterator/child).
- Prod dùng `ANTHROPIC_API_KEY` (pay-per-token), **không** dùng login Claude của máy.

**Phương án loại bỏ.** Redis + BullMQ + worker tách: tốt cho Direction B, thừa cho beta single-node.

---

## ADR-5 — Cost-cap & đo usage (KHÔNG billing)

**Quyết định.** Gác hệ thống thu tiền, nhưng **bắt buộc** có trần chi phí + đo lường:
- **Quota/user/ngày:** số agent-run/ngày; giữ `maxTurns` (đang 24, [agent/options.ts:60](src/agent/options.ts#L60)).
- **Circuit-breaker toàn cục:** trần chi phí token/ngày cho cả beta; vượt → endpoint agent trả
  `429` kèm thông điệp "beta đang quá tải, thử lại sau".
- **Metering:** ghi mỗi run `{user, tenant, costUsd, numTurns, model, ts}` vào SQLite.

**Vì sao.** Bảo vệ ví khi free + công khai-trong-nhóm; đồng thời tạo **dữ liệu nền cho quyết
định billing sau** (một user "hài lòng" tốn ta bao nhiêu?).

**Hệ quả.** Cần đọc quota trước khi enqueue run; cập nhật metering khi run xong.

---

## ADR-6 — Hardening mạng & secrets

**Quyết định (bắt buộc trước khi mở cho người ngoài).**
- Bind `127.0.0.1`, đặt sau **reverse proxy + TLS** (Caddy/Fly). Bỏ `0.0.0.0` trực tiếp ra net
  ([api/main.ts:29](src/api/main.ts#L29)).
- **CORS** khoá đúng origin app; **rate-limit** toàn cục (`@fastify/rate-limit`);
  **security headers** (`@fastify/helmet`). Giữ giới hạn body multipart 25MB.
- **Chặn SSRF** ở publish webhook ([api/server.ts:243](src/api/server.ts#L243)): chỉ cho
  `https`, resolve DNS và **chặn dải IP private/loopback/link-local/metadata** trước khi `fetch`.
- **Mã hoá secret at-rest:** `webhookUrl` đang lưu plaintext ([publish/store.ts](src/publish/store.ts))
  — mã hoá bằng khoá server, hoặc tối thiểu cô lập theo tenant + không log.

---

## ADR-7 — Lưu trữ metadata SaaS: **SQLite trên volume**

**Quyết định.** Dữ liệu quan hệ của tầng SaaS (invites, users, tenants, runs, usage, feedback,
analytics-events) lưu ở **SQLite** (better-sqlite3) đặt trên persistent volume, **tách khỏi git**.

**Vì sao.** Quan hệ + truy vấn (quota/ngày, funnel) cần SQL; single-node nên SQLite là đủ,
không cần Postgres. Khi lên Direction B mới cân nhắc Postgres quản lý.

**Hệ quả.** Thêm migration nhẹ cho schema; backup SQLite kèm backup volume (ADR-1).

---

## ADR-8 — Vòng phản hồi & analytics (đây là MỤC TIÊU, không phải phụ)

**Quyết định.** Vì beta tồn tại để **đo hài lòng**, các thứ sau là P0:
- **Funnel activation:** sự kiện signup → tạo workspace → proposal đầu → **merge đầu** →
  publish đầu. Ghi vào bảng `events` (SQLite) hoặc PostHog (free tier).
- **Retention:** đo quay lại D7/D30.
- **Feedback in-app:** nút "Góp ý" → ghi bảng `feedback` + email cho bạn. Biến văn hoá
  [FINDINGS.md](FINDINGS.md) thành dữ liệu từ user thật.
- **Khảo sát ngắn/NPS** sau lần merge đầu (1–2 câu).
- **Nhịp review hằng tuần:** activation rate, D7 retention, chủ đề feedback, cost/active-user.

---

## Hoãn lại (cố ý — ngoài phạm vi beta)

- Billing/Stripe, gói cước, giá, paywall.
- Đăng ký mở + chống-bot/captcha (vì invite-only).
- Multi-node / scale ngang / sandbox per-run / distributed lock (Direction B).
- Org nhiều-thành-viên, RBAC chi tiết (beta: 1 user = 1 tenant).
- Auto-reconcile drift sidecar↔git ([KNOWN_LIMITATIONS #2](KNOWN_LIMITATIONS.md)): beta chỉ
  cần **script repair thủ công** + cảnh báo; auto để sau.
- Pháp lý nặng: beta chỉ cần **thông báo beta + Privacy ngắn** và **xoá dữ liệu theo yêu cầu**
  (xoá subtree tenant + bản ghi user).

---

## Thứ tự xây (mỗi bước ship được, không phải làm lại)

1. ✅ **Nền multi-tenant trong engine** (ADR-2): root theo tenant + serializer key `${tenant}:${ws}`.
2. ✅ **SQLite + schema** (ADR-7): invites, users, tenants, runs, usage, feedback, events.
3. ✅ **Auth invite-only** (ADR-3): magic-link + allowlist (3a) + `requireAuth` + tenant-scope (3b) + web login UI (3c).
4. **Hardening mạng** (ADR-6): proxy/TLS, CORS, rate-limit, helmet, SSRF guard, mã hoá webhook.
5. **Agent queue + cost-cap + metering** (ADR-4, ADR-5): tách run, quota, circuit-breaker, ghi usage.
6. **Analytics + feedback** (ADR-8): funnel + nút Góp ý + NPS.
7. **Deploy**: Dockerfile + start production (thay `node --watch` ở [package.json:13](package.json#L13)),
   volume, backup cron, healthcheck.
8. **Vận hành**: logging có cấu trúc, error tracking, script repair drift.

Ước lượng: cỡ **vài tuần** tập trung. Lõi (git engine) tái dùng; phần SaaS gần như xây mới
nhưng phạm vi beta đã được cắt còn tối thiểu.

---

## Rủi ro & câu hỏi mở

- **Trần single-node**: nếu beta hút user nhanh hơn dự kiến, phải nhảy Direction B sớm — chấp
  nhận được vì mục tiêu là *học*, không phải scale.
- **Child-process per agent run** vẫn nặng; cap đồng thời che được cho beta, nhưng là nợ kỹ thuật.
- **Chọn auth managed vs self-host**: quyết khi vào bước 3 (mặc định nghiêng managed cho tốc độ).
- **Nền tảng deploy cụ thể** (Fly vs VPS): quyết khi vào bước 7.
