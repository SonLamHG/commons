# Google Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay magic-link bằng đăng nhập Google theo luồng server-side OAuth Authorization Code, bỏ allowlist và mailer.

**Architecture:** Một interface `GoogleOAuth` (giống cách `Mailer` được inject) đóng gói mọi giao tiếp HTTP với Google. `routes.ts` chỉ thấy interface đó nên test mock dễ dàng. Session/tenant/seed giữ nguyên. State CSRF dùng cookie httpOnly + token signed.

**Tech Stack:** TypeScript (ESM, tsx), Fastify, vitest, React 19. Không thêm SDK — gọi Google qua `fetch` thuần.

## Global Constraints

- Không dùng SDK cho Google — chỉ `fetch` (theo phong cách `resendMailer`).
- Mọi mutating engine call vẫn qua `WorkspaceSerializer` (không liên quan trực tiếp ở đây nhưng giữ nguyên).
- MCP stdio cấm `console.log`; auth chỉ ở API nên không ảnh hưởng.
- Test build engine/db thật (`createDb(':memory:')`, `app.inject`) — không mock git.
- Tên cookie session giữ nguyên: `commons_session`. Cookie state mới: `commons_oauth_state`.
- Redirect URI: `${appUrl}/api/auth/google/callback`.
- UI tiếng Việt, giữ class `login-card`, `kicker`, `login-head`.

---

### Task 1: `GoogleOAuth` client (HTTP thuần)

**Files:**
- Create: `src/auth/google.ts`
- Test: `test/auth-google.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface GoogleProfile { email: string; emailVerified: boolean; }
  export interface GoogleOAuth {
    /** URL để redirect user tới Google. */
    authUrl(state: string): string;
    /** Đổi authorization code -> hồ sơ; null nếu thất bại/không có email. */
    exchangeCode(code: string): Promise<GoogleProfile | null>;
  }
  export function createGoogleOAuth(cfg: {
    clientId: string; clientSecret: string; redirectUri: string;
  }): GoogleOAuth;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// test/auth-google.test.ts
import { describe, it, expect } from 'vitest';
import { createGoogleOAuth } from '../src/auth/google.js';

const cfg = {
  clientId: 'cid.apps.googleusercontent.com',
  clientSecret: 'secret',
  redirectUri: 'http://localhost:8787/api/auth/google/callback',
};

describe('createGoogleOAuth.authUrl', () => {
  it('builds a Google consent URL with required params', () => {
    const url = new URL(createGoogleOAuth(cfg).authUrl('state-123'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(cfg.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(cfg.redirectUri);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('state')).toBe('state-123');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auth-google.test.ts -t "builds a Google consent URL"`
Expected: FAIL — cannot find module `../src/auth/google.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/auth/google.ts
export interface GoogleProfile { email: string; emailVerified: boolean; }

export interface GoogleOAuth {
  authUrl(state: string): string;
  exchangeCode(code: string): Promise<GoogleProfile | null>;
}

interface Cfg { clientId: string; clientSecret: string; redirectUri: string; }

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Decode the payload segment of a JWT (no signature check — token came
 *  straight from Google over HTTPS in this request). */
function decodeIdToken(idToken: string): { email?: string; email_verified?: boolean } | null {
  const seg = idToken.split('.')[1];
  if (!seg) return null;
  try { return JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')); }
  catch { return null; }
}

export function createGoogleOAuth(cfg: Cfg): GoogleOAuth {
  return {
    authUrl(state) {
      const u = new URL(AUTH_ENDPOINT);
      u.search = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: cfg.redirectUri,
        response_type: 'code',
        scope: 'openid email',
        state,
        access_type: 'online',
        prompt: 'select_account',
      }).toString();
      return u.toString();
    },
    async exchangeCode(code) {
      const r = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
      if (!r.ok) return null;
      const tok = (await r.json()) as { id_token?: string };
      if (!tok.id_token) return null;
      const claims = decodeIdToken(tok.id_token);
      if (!claims || typeof claims.email !== 'string') return null;
      return { email: claims.email.toLowerCase(), emailVerified: claims.email_verified === true };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/auth-google.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/google.ts test/auth-google.test.ts
git commit -m "feat(auth): add GoogleOAuth client (authUrl + exchangeCode)"
```

---

### Task 2: State token helpers + drop magic token

**Files:**
- Modify: `src/auth/token.ts`
- Modify: `test/auth-token.test.ts`

**Interfaces:**
- Consumes: `sign`/`verify` from `./sign.js`.
- Produces:
  ```ts
  export function createState(secret: string, ttlMs?: number): string;
  export function readState(state: string, secret: string, now?: number): boolean;
  ```
  (`createSession`/`readSession` unchanged. `createMagicToken`/`readMagicToken` removed.)

- [ ] **Step 1: Write the failing test**

Replace the magic-token tests in `test/auth-token.test.ts` with state tests (keep any existing session tests):

```ts
import { describe, it, expect } from 'vitest';
import { createState, readState, createSession, readSession } from '../src/auth/token.js';

const SECRET = 'test-secret';

describe('state token', () => {
  it('round-trips a fresh state', () => {
    const s = createState(SECRET);
    expect(readState(s, SECRET)).toBe(true);
  });
  it('rejects a tampered state', () => {
    expect(readState('garbage', SECRET)).toBe(false);
  });
  it('rejects an expired state', () => {
    const s = createState(SECRET, 1000);
    expect(readState(s, SECRET, Date.now() + 2000)).toBe(false);
  });
});

describe('session token', () => {
  it('round-trips a userId', () => {
    expect(readSession(createSession('u_1', SECRET), SECRET)).toBe('u_1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auth-token.test.ts`
Expected: FAIL — `createState` is not exported.

- [ ] **Step 3: Edit `src/auth/token.ts`**

Delete `createMagicToken` and `readMagicToken`. Add (keep the existing `enc`/`dec`/session helpers):

```ts
import { randomBytes } from 'node:crypto';

/** Short-lived signed CSRF state for the OAuth round-trip (default 10 min). */
export function createState(secret: string, ttlMs = 10 * 60_000): string {
  return sign(enc({ nonce: randomBytes(8).toString('base64url'), exp: Date.now() + ttlMs }), secret);
}

/** True if the state is a valid, unexpired token signed by us. */
export function readState(state: string, secret: string, now = Date.now()): boolean {
  const payload = verify(state, secret);
  if (!payload) return false;
  try {
    const o = dec(payload) as { exp?: unknown };
    return typeof o.exp === 'number' && o.exp > now;
  } catch { return false; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/auth-token.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/token.ts test/auth-token.test.ts
git commit -m "feat(auth): replace magic token with signed OAuth state token"
```

---

### Task 3: Rewrite auth routes for Google

**Files:**
- Modify: `src/auth/routes.ts`
- Modify: `test/auth-routes.test.ts`
- Delete: `src/auth/mailer.ts`, `test/auth-mailer.test.ts`

**Interfaces:**
- Consumes: `GoogleOAuth`, `GoogleProfile` (Task 1); `createState`/`readState`/`createSession`/`readSession` (Task 2).
- Produces (new `AuthDeps`):
  ```ts
  export interface AuthDeps {
    db: Db;
    secret: string;
    appUrl: string;
    google: GoogleOAuth;
    seedTenant?: (tenantId: string) => Promise<void>;
  }
  ```
  Routes: `GET /api/auth/google/start`, `GET /api/auth/google/callback`,
  `POST /api/auth/logout`, `GET /api/auth/session`, `GET /api/auth/me`.
  `makeRequireAuth(deps)` unchanged in behaviour.

- [ ] **Step 1: Rewrite `test/auth-routes.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb } from '../src/db/index.js';
import { registerAuthRoutes } from '../src/auth/routes.js';
import type { GoogleOAuth, GoogleProfile } from '../src/auth/google.js';

const SECRET = 'test-secret';
const APP_URL = 'http://localhost:8787';

let app: FastifyInstance;
let db: ReturnType<typeof createDb>;
let profile: GoogleProfile | null;

const fakeGoogle: GoogleOAuth = {
  authUrl: (state) => `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  async exchangeCode() { return profile; },
};

beforeEach(async () => {
  db = createDb(':memory:');
  profile = { email: 'alice@example.com', emailVerified: true };
  app = Fastify();
  registerAuthRoutes(app, { db, secret: SECRET, appUrl: APP_URL, google: fakeGoogle });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const cookieVal = (res: { headers: Record<string, unknown> }, name: string) => {
  const sc = res.headers['set-cookie'];
  const arr = Array.isArray(sc) ? sc : [sc as string];
  const raw = arr.find((c) => c.startsWith(name + '='))!;
  return raw.split(';')[0]; // "name=value"
};

describe('google auth routes', () => {
  it('start redirects to Google and sets a state cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    expect(cookieVal(res, 'commons_oauth_state')).toContain('commons_oauth_state=');
  });

  it('completes the callback for a verified email', async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    const stateCookie = cookieVal(start, 'commons_oauth_state');
    const state = decodeURIComponent(stateCookie.split('=')[1]);

    const cb = await app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(APP_URL + '/');

    const user = db.getUserByEmail('alice@example.com');
    expect(user).toBeDefined();
    expect(db.getTenant(user!.tenant_id)).toBeDefined();

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieVal(cb, 'commons_session') } });
    expect(me.json()).toMatchObject({ email: 'alice@example.com' });
  });

  it('rejects a callback whose state does not match the cookie', async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    const stateCookie = cookieVal(start, 'commons_oauth_state');
    const cb = await app.inject({
      method: 'GET', url: '/api/auth/google/callback?code=abc&state=wrong',
      headers: { cookie: stateCookie },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(APP_URL + '/?error=auth');
    expect(db.getUserByEmail('alice@example.com')).toBeUndefined();
  });

  it('rejects an unverified email', async () => {
    profile = { email: 'bob@example.com', emailVerified: false };
    const start = await app.inject({ method: 'GET', url: '/api/auth/google/start' });
    const stateCookie = cookieVal(start, 'commons_oauth_state');
    const state = decodeURIComponent(stateCookie.split('=')[1]);
    const cb = await app.inject({
      method: 'GET', url: `/api/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie: stateCookie },
    });
    expect(cb.headers.location).toBe(APP_URL + '/?error=auth');
    expect(db.getUserByEmail('bob@example.com')).toBeUndefined();
  });

  it('rejects /me without a session', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(me.statusCode).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(out.statusCode).toBe(200);
    const sc = out.headers['set-cookie'];
    const raw = Array.isArray(sc) ? sc[0] : (sc as string);
    expect(raw).toContain('Max-Age=0');
  });
});
```

- [ ] **Step 2: Delete the mailer files**

```bash
git rm src/auth/mailer.ts test/auth-mailer.test.ts
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/auth-routes.test.ts`
Expected: FAIL — `registerAuthRoutes` still expects `mailer`; `google` start/callback routes missing.

- [ ] **Step 4: Rewrite `src/auth/routes.ts`**

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/types.js';
import type { GoogleOAuth } from './google.js';
import { generateId } from '../util/id.js';
import { createState, readState, createSession, readSession } from './token.js';
import { serializeCookie, parseCookies } from './cookie.js';

export interface AuthDeps {
  db: Db;
  secret: string;
  appUrl: string;
  google: GoogleOAuth;
  /** Called once when a brand-new tenant is created, to seed its demo content. */
  seedTenant?: (tenantId: string) => Promise<void>;
}

const COOKIE = 'commons_session';
const STATE_COOKIE = 'commons_oauth_state';

/** Fastify preHandler: require a valid session; sets request.auth = { userId, tenantId }. */
export function makeRequireAuth(deps: AuthDeps) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    const userId = raw ? readSession(raw, deps.secret) : null;
    const user = userId ? deps.db.getUserById(userId) : undefined;
    if (!user) return reply.code(401).send({ error: 'unauthenticated' });
    (req as FastifyRequest & { auth: { userId: string; tenantId: string } }).auth = {
      userId: user.id, tenantId: user.tenant_id,
    };
  };
}

/** Register the Google OAuth auth routes on `app`. */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const secure = deps.appUrl.startsWith('https');

  app.get('/api/auth/google/start', async (_req, reply) => {
    const state = createState(deps.secret);
    reply.header('set-cookie', serializeCookie(STATE_COOKIE, state, {
      httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 600,
    }));
    return reply.code(302).header('location', deps.google.authUrl(state)).send();
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const fail = () => reply.code(302).header('location', deps.appUrl + '/?error=auth').send();
    const { code, state } = req.query as { code?: string; state?: string };
    const cookieState = parseCookies(req.headers.cookie)[STATE_COOKIE];

    // CSRF: query state must match the cookie state and be a valid signed token.
    if (!code || !state || !cookieState || state !== cookieState || !readState(state, deps.secret)) {
      return fail();
    }

    const profile = await deps.google.exchangeCode(code);
    if (!profile || !profile.emailVerified) return fail();

    const email = profile.email.trim().toLowerCase();
    let user = deps.db.getUserByEmail(email);
    if (!user) {
      const tenantId = generateId('t');
      deps.db.createTenant(tenantId);
      user = deps.db.createUser(email, tenantId);
      // Seed demo content so the first screen is populated. A seed failure must
      // never block sign-in — log and continue with an empty workspace.
      if (deps.seedTenant) {
        try { await deps.seedTenant(tenantId); }
        catch (e) { req.log.error({ err: e, tenantId }, 'failed to seed onboarding workspace'); }
      }
    }

    const session = createSession(user.id, deps.secret);
    reply.header('set-cookie', [
      serializeCookie(COOKIE, session, { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 3600 }),
      serializeCookie(STATE_COOKIE, '', { httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 0 }),
    ]);
    return reply.code(302).header('location', deps.appUrl + '/').send();
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', serializeCookie(COOKIE, '', {
      httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 0,
    }));
    return reply.send({ ok: true });
  });

  // Unauthenticated-friendly probe: always 200 so the SPA's initial "am I
  // logged in?" check never surfaces a 401 in the browser console.
  app.get('/api/auth/session', async (req) => {
    const raw = parseCookies(req.headers.cookie)[COOKIE];
    const userId = raw ? readSession(raw, deps.secret) : null;
    const user = userId ? deps.db.getUserById(userId) : undefined;
    if (!user) return { authenticated: false as const };
    return { authenticated: true as const, userId: user.id, tenantId: user.tenant_id, email: user.email };
  });

  const requireAuth = makeRequireAuth(deps);
  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const { userId, tenantId } = (req as FastifyRequest & { auth: { userId: string; tenantId: string } }).auth;
    const user = deps.db.getUserById(userId)!;
    return { userId, tenantId, email: user.email };
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/auth-routes.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 6: Commit**

```bash
git add src/auth/routes.ts test/auth-routes.test.ts
git rm src/auth/mailer.ts test/auth-mailer.test.ts
git commit -m "feat(auth): replace magic-link routes with Google OAuth; drop mailer"
```

---

### Task 4: Wire deps through API server + main

**Files:**
- Modify: `src/api/server.ts` (`ApiDeps` ~line 70-94)
- Modify: `src/api/main.ts`

**Interfaces:**
- Consumes: `registerAuthRoutes`/`makeRequireAuth` with new `AuthDeps` (Task 3); `createGoogleOAuth` (Task 1).
- `ApiDeps`: remove `mailer`, `openSignup`; add `google: GoogleOAuth`.

- [ ] **Step 1: Edit `src/api/server.ts`**

Remove the `Mailer` import. Update `ApiDeps`:

```ts
export interface ApiDeps {
  registry: EngineRegistry;
  serializer: WorkspaceSerializer;
  db: Db;
  authSecret: string;
  appUrl: string;
  google: GoogleOAuth;
  agentRunner?: AgentRunner;
  /** Called once per new tenant to seed its demo content. */
  seedTenant?: (tenantId: string) => Promise<void>;
}
```

Add at the top with the other auth imports:
```ts
import type { GoogleOAuth } from '../auth/google.js';
```

Update the destructure and wiring (replace the `mailer`/`openSignup` usages):
```ts
const { registry, serializer, db, authSecret, appUrl, google, agentRunner, seedTenant } = deps;
```
```ts
registerAuthRoutes(app, { db, secret: authSecret, appUrl, google, seedTenant });
const requireAuth = makeRequireAuth({ db, secret: authSecret, appUrl, google });
```

- [ ] **Step 2: Edit `src/api/main.ts`**

Remove the mailer import and the `COMMONS_INVITES` seeding loop and `openSignup`. Replace with Google config:

Remove:
```ts
import { mailerFromEnv } from '../auth/mailer.js';
```
```ts
// Beta allowlist: seed invited emails from COMMONS_INVITES (comma-separated).
for (const email of (process.env.COMMONS_INVITES ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
  db.addInvite(email);
}
```

Add after the `authSecret` guard:
```ts
import { createGoogleOAuth } from '../auth/google.js';
```
```ts
const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!googleClientId || !googleClientSecret) {
  process.stderr.write('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required (set them in .env) — refusing to start.\n');
  process.exit(1);
}
const google = createGoogleOAuth({
  clientId: googleClientId,
  clientSecret: googleClientSecret,
  redirectUri: `${appUrl}/api/auth/google/callback`,
});
```

Update the `buildApi({...})` call: remove `mailer` and `openSignup`, add `google`:
```ts
const app = buildApi({
  registry,
  serializer,
  db,
  authSecret,
  appUrl,
  google,
  agentRunner: createClaudeRunner(),
  seedTenant,
});
```

- [ ] **Step 3: Build-check the server wiring**

Run: `npx tsc --noEmit`
Expected: no errors (no remaining references to `mailer`/`openSignup`/`COMMONS_INVITES`).

- [ ] **Step 4: Run the full backend test suite**

Run: `npm test`
Expected: PASS — including `test/auth-google.test.ts`, `test/auth-token.test.ts`, `test/auth-routes.test.ts`. No reference to deleted `auth-mailer.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/api/server.ts src/api/main.ts
git commit -m "feat(api): inject GoogleOAuth, drop mailer and invite allowlist wiring"
```

---

### Task 5: Frontend — Google button

**Files:**
- Modify: `web/src/components/Login.tsx`
- Modify: `web/src/api.ts` (remove `auth.request`)

**Interfaces:**
- Consumes: backend route `/api/auth/google/start` and `?error=auth` query.

- [ ] **Step 1: Edit `web/src/api.ts`**

Delete the `request` method from `api.auth`:
```ts
request: (email: string): Promise<{ ok: boolean }> =>
  fetch('/api/auth/request', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  }).then(j),
```
Leave `session`, `me`, `logout` intact.

- [ ] **Step 2: Replace `web/src/components/Login.tsx`**

```tsx
import React from 'react';

export function Login() {
  const error = new URLSearchParams(window.location.search).has('error');

  return (
    <div className="login">
      <div className="login-card">
        <span className="kicker">Bàn duyệt Commons</span>
        <h2 className="login-head">Đăng nhập<span className="period">.</span></h2>
        <p className="login-lede">
          Đăng nhập bằng tài khoản Google của bạn để vào Commons.
        </p>
        <a className="btn approve" href="/api/auth/google/start">
          Đăng nhập với Google
        </a>
        {error && (
          <p className="notice notice--error" role="alert">
            Đăng nhập không thành công. Vui lòng thử lại.
          </p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build the web bundle**

Run: `npm run build:web`
Expected: build succeeds, no TypeScript/Vite errors (no leftover `friendlyError`/`api.auth.request` references in `Login.tsx`).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Login.tsx web/src/api.ts
git commit -m "feat(web): replace magic-link login form with Google sign-in button"
```

---

### Task 6: Update docs (env + CLAUDE.md)

**Files:**
- Modify: `.env.example` (if present — else skip)
- Modify: `CLAUDE.md` if it references magic-link/mailer/invites (grep first)

**Interfaces:** none (docs only).

- [ ] **Step 1: Grep for stale references**

Run: `git grep -n -i -E "magic|RESEND|MAIL_FROM|COMMONS_INVITES|COMMONS_OPEN_SIGNUP|mailer"`
Expected: only matches in docs/spec/plan files (no source references remain). If `.env.example` lists `RESEND_API_KEY`/`MAIL_FROM`/`COMMONS_INVITES`/`COMMONS_OPEN_SIGNUP`, replace them with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

- [ ] **Step 2: Update `.env.example` (only if it exists)**

Remove `RESEND_API_KEY`, `MAIL_FROM`, `COMMONS_INVITES`, `COMMONS_OPEN_SIGNUP`. Add:
```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 3: Verify full suite still green**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: document Google OAuth env vars, drop magic-link/mailer refs"
```

---

## Self-Review

**Spec coverage:**
- Luồng OAuth start/callback → Task 3. ✓
- `google.ts` HTTP thuần → Task 1. ✓
- State CSRF → Task 2 + Task 3. ✓
- Xóa magic token → Task 2; xóa mailer → Task 3; xóa allowlist wiring → Task 4. ✓
- Env config → Task 4 + Task 6. ✓
- UI nút Google → Task 5. ✓
- Tests theo pattern app.inject → Task 1/2/3. ✓
- email_verified bắt buộc → Task 3 (callback `!profile.emailVerified`). ✓

**Placeholder scan:** không có TBD/TODO; mọi step code đầy đủ.

**Type consistency:** `GoogleOAuth.authUrl(state)` / `exchangeCode(code) -> GoogleProfile|null` dùng nhất quán ở Task 1/3/4. `createState/readState` chữ ký khớp Task 2↔3. Cookie names `commons_session`/`commons_oauth_state` nhất quán.
