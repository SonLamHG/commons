# Thay magic-link bằng đăng nhập Google

Ngày: 2026-06-23

## Mục tiêu

Thay thế hoàn toàn cơ chế đăng nhập magic-link (email → link dùng một lần) bằng
đăng nhập Google theo luồng **server-side OAuth Authorization Code**. Bỏ luôn
invite allowlist: bất kỳ tài khoản Google có email đã xác minh đều đăng nhập được.

Phần **session, tenant, seed demo giữ nguyên** — chỉ thay phần "chứng minh danh tính".

## Luồng

```
Login.tsx  "Đăng nhập với Google"  → GET /api/auth/google/start
   → set cookie state (httpOnly, ngắn hạn) + 302 tới Google
        scope: openid email, response_type=code, state=<signed>
   → user đồng ý ở Google
   → 302 về GET /api/auth/google/callback?code=&state=
        1. đối chiếu state query với cookie state + verify chữ ký/TTL  → lỗi: 302 /?error=auth
        2. POST token endpoint đổi code → { id_token, access_token }
        3. lấy email + email_verified (giải mã id_token; fallback userinfo endpoint)
        4. yêu cầu email_verified === true, normalize lowercase
        5. tìm/tạo user + tenant, seedTenant (logic cũ ở callback magic-link, bê nguyên)
        6. createSession → set cookie commons_session (giữ nguyên)
        7. xóa cookie state, 302 về '/'
```

## Thành phần

### `src/auth/google.ts` (mới)
HTTP thuần, không SDK (theo phong cách `resendMailer`).
- `buildAuthUrl(opts: { clientId; redirectUri; state }): string` — dựng URL
  `https://accounts.google.com/o/oauth2/v2/auth` với `scope=openid email`,
  `response_type=code`, `access_type=online`, `prompt=select_account`.
- `exchangeCode(opts: { code; clientId; clientSecret; redirectUri }): Promise<{ idToken: string; accessToken: string }>`
  — POST `https://oauth2.googleapis.com/token`.
- `fetchEmail(tokens): Promise<{ email: string; emailVerified: boolean } | null>`
  — giải mã payload `id_token` (base64url, không cần verify chữ ký RS256 vì token
  vừa lấy trực tiếp từ Google qua HTTPS); nếu thiếu email thì gọi
  `https://openidconnect.googleapis.com/v1/userinfo` với access token.

### `src/auth/token.ts`
- **Xóa** `createMagicToken` / `readMagicToken`.
- **Thêm** `createState(secret, ttlMs=10*60_000): { state, nonce }` và
  `readState(state, secret): boolean` — token signed (dùng `sign`/`verify` hiện có)
  mang nonce + exp, chống CSRF. State trong cookie phải khớp state trong query.
- Giữ nguyên `createSession` / `readSession`.

### `src/auth/routes.ts`
- **Xóa** `POST /api/auth/request` và `GET /api/auth/callback` (magic-link).
- **Thêm** `GET /api/auth/google/start` và `GET /api/auth/google/callback`.
- `AuthDeps`: bỏ `mailer`, bỏ `openSignup`, bỏ helper `allowed()` và mọi
  invite-check; thêm `googleClientId`, `googleClientSecret`, `googleRedirectUri`.
- Giữ `makeRequireAuth`, `/api/auth/logout`, `/api/auth/session`, `/api/auth/me`
  không đổi (chỉ là chúng dùng cùng `AuthDeps` đã bớt field).
- `markInviteAccepted` không còn ý nghĩa khi bỏ allowlist → bỏ lời gọi.

### `src/auth/mailer.ts`
- **Xóa file** (chỉ phục vụ magic-link, không nơi nào khác dùng).

### `src/api/server.ts`
- `ApiDeps`: bỏ `mailer`, `openSignup`; thêm `googleClientId`,
  `googleClientSecret`, `googleRedirectUri`.
- Cập nhật `registerAuthRoutes(...)` và `makeRequireAuth(...)` theo deps mới.
- Bỏ import `Mailer`.

### `src/api/main.ts`
- Bỏ import + dùng `mailerFromEnv`.
- Bỏ vòng seed `COMMONS_INVITES` và `openSignup` (allowlist bị bỏ).
- Đọc env: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; suy ra
  `googleRedirectUri = `${appUrl}/api/auth/google/callback``.
- Nếu thiếu client id/secret → log cảnh báo và thoát (giống `COMMONS_AUTH_SECRET`).

### `web/src/components/Login.tsx`
- Bỏ form email + state `sent`/`busy`/`error` và lời gọi `api.auth.request`.
- Còn một nút/anchor "Đăng nhập với Google" trỏ tới `/api/auth/google/start`
  (điều hướng cả trang, không fetch). Đọc `?error=auth` trên URL để hiện thông báo lỗi.
- Giữ phong cách thẻ `login-card`, kicker, tiêu đề tiếng Việt.

### `web/src/api.ts`
- Bỏ `auth.request`. Giữ `auth.session` / `auth.logout` / `auth.me` nếu có.

## Cấu hình (env)

| Biến | Ý nghĩa |
|---|---|
| `GOOGLE_CLIENT_ID` | OAuth client id (bắt buộc) |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret (bắt buộc) |
| `COMMONS_APP_URL` | đã có; redirect URI suy ra từ đây |

Redirect URI cần khai báo trong Google Cloud Console:
`${COMMONS_APP_URL}/api/auth/google/callback`.

Bỏ khỏi sử dụng: `RESEND_API_KEY`, `MAIL_FROM`, `COMMONS_OPEN_SIGNUP`,
`COMMONS_INVITES` (allowlist không còn).

## Bảo mật

- State CSRF: signed + TTL ngắn, lưu cookie `httpOnly`; query state phải khớp.
- Bắt buộc `email_verified === true`.
- Cookie session giữ nguyên: `httpOnly`, `secure` khi https, `SameSite=Lax`,
  maxAge 30 ngày.
- Callback lỗi → 302 `/?error=auth`, không lộ chi tiết.
- Không log token/code.

## Test (pattern `app.inject`, build engine thật trên mkdtemp)

- Inject phụ thuộc `google.ts` để mock `exchangeCode`/`fetchEmail` (qua tham số
  hàm hoặc factory) — không gọi mạng thật trong test.
- `start` → 302 tới accounts.google.com, có set-cookie state.
- `callback` hợp lệ (email_verified) → tạo user+tenant, gọi seedTenant, set
  cookie session, 302 '/'.
- `callback` state mismatch / thiếu state cookie → 302 `/?error=auth`.
- `callback` email_verified=false → 302 `/?error=auth`, không tạo user.
- User đã tồn tại → đăng nhập lại, không tạo tenant mới.

## Ngoài phạm vi (YAGNI)

- Không thêm provider OAuth khác (chỉ Google).
- Không refresh token / offline access.
- Không quản lý nhiều tài khoản Google trên một user.
- Không giữ magic-link làm fallback.
