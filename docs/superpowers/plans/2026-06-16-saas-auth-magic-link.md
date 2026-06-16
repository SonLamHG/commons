# Auth Subsystem — Self-Host Magic-Link (Step 3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the invite-only, passwordless (magic-link) authentication subsystem — token/session signing, a dependency-free cookie util, a pluggable mailer, and the auth HTTP routes (`request`/`callback`/`logout`/`me`) plus a `requireAuth` guard — as an isolated, fully-tested module.

**Architecture:** Step 3 of [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md) (ADR-3) is split into **3a (this plan)** and **3b (next)**. 3a delivers the auth machinery in a new `src/auth/` module, using `node:crypto` HMAC for tokens/sessions (no auth SDK) and the SQLite store from Step 2 for invites/users/tenants. Email goes through a `Mailer` interface: a Resend HTTP impl (via `fetch`, no SDK) when configured, else a console dev mailer that prints the magic link to stderr. **3b** then wires `requireAuth` + the `EngineRegistry`/`scopeKey` (Step 1) into `buildApi` to enforce auth and tenant-isolate every resource endpoint.

**Scope guard:** 3a is **purely additive** — new files under `src/auth/` + tests using standalone Fastify apps. It does NOT modify `src/api/server.ts`, `src/api/main.ts`, or `test/api.test.ts`. All 122 existing tests stay green; this step only adds tests. Enforcement (applying `requireAuth` to resource routes) and tenant rewiring happen in 3b.

**Tech Stack:** TypeScript (ESM, tsx), Vitest, Fastify (for the routes plugin + tests via `app.inject`), `node:crypto` (`createHmac`, `timingSafeEqual`), `fetch` (Resend), the Step-2 `Db`, and `generateId` from `src/util/id.ts`.

**Conventions locked in here (reused by 3b):**
- Server secret comes from `COMMONS_AUTH_SECRET` (wired in 3b's `main.ts`); 3a passes it explicitly.
- Emails normalised `trim().toLowerCase()` (matches the Step-2 store).
- Session cookie name: `commons_session` (httpOnly, SameSite=Lax, Path=/, 30-day Max-Age, Secure when appUrl is https).
- Magic token TTL 15 min; session TTL 30 days.
- `request.auth = { userId, tenantId }` is set by `requireAuth`.
- `/api/auth/request` always returns `{ ok: true }` (never leaks whether an email is invited).

---

### Task 1: HMAC signing primitive

**Files:**
- Create: `src/auth/sign.ts`
- Test: `test/auth-sign.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/auth-sign.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sign, verify } from '../src/auth/sign.js';

describe('auth/sign', () => {
  it('round-trips a payload with the right secret', () => {
    const s = sign('hello', 'secret');
    expect(s.startsWith('hello.')).toBe(true);
    expect(verify(s, 'secret')).toBe('hello');
  });

  it('rejects a wrong secret', () => {
    expect(verify(sign('hello', 'secret'), 'other')).toBeNull();
  });

  it('rejects a tampered payload', () => {
    const s = sign('hello', 'secret');
    expect(verify('hello.' + s.split('.')[1], 'secret')).toBeNull();
  });

  it('rejects a malformed value', () => {
    expect(verify('nodot', 'secret')).toBeNull();
    expect(verify('', 'secret')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/auth-sign.test.ts`
Expected: FAIL — cannot find module `../src/auth/sign.js`.

- [ ] **Step 3: Write the implementation**

Create `src/auth/sign.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

const mac = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/** HMAC-SHA256 sign a payload -> "payload.sig" (base64url sig). */
export function sign(payload: string, secret: string): string {
  return `${payload}.${mac(payload, secret)}`;
}

/** Verify "payload.sig"; return the payload if the signature matches, else null. */
export function verify(signed: string, secret: string): string | null {
  const i = signed.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = signed.slice(0, i);
  const a = Buffer.from(signed.slice(i + 1));
  const b = Buffer.from(mac(payload, secret));
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? payload : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/auth-sign.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/auth/sign.ts test/auth-sign.test.ts
git commit -m "feat(auth): add HMAC sign/verify primitive"
```
(Append the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.)

---

### Task 2: Magic-link tokens & session values

**Files:**
- Create: `src/auth/token.ts`
- Test: `test/auth-token.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/auth-token.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createMagicToken, readMagicToken, createSession, readSession } from '../src/auth/token.js';

const SECRET = 'test-secret';

describe('auth/token', () => {
  it('reads back the email from a fresh magic token (normalised)', () => {
    const t = createMagicToken('Alice@Example.com', SECRET);
    expect(readMagicToken(t, SECRET)).toBe('alice@example.com');
  });

  it('rejects an expired magic token', () => {
    const t = createMagicToken('a@x.com', SECRET, 1000);
    expect(readMagicToken(t, SECRET, Date.now() + 2000)).toBeNull();
  });

  it('rejects a magic token signed with another secret', () => {
    expect(readMagicToken(createMagicToken('a@x.com', SECRET), 'other')).toBeNull();
  });

  it('reads back the userId from a fresh session', () => {
    const s = createSession('usr-1', SECRET);
    expect(readSession(s, SECRET)).toBe('usr-1');
  });

  it('rejects an expired session', () => {
    const s = createSession('usr-1', SECRET, 1000);
    expect(readSession(s, SECRET, Date.now() + 2000)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/auth-token.test.ts`
Expected: FAIL — cannot find module `../src/auth/token.js`.

- [ ] **Step 3: Write the implementation**

Create `src/auth/token.ts`:
```ts
import { sign, verify } from './sign.js';

const enc = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
const dec = (s: string): unknown => JSON.parse(Buffer.from(s, 'base64url').toString('utf8'));

/** Magic-link token carrying a normalised email, valid for ttlMs (default 15 min). */
export function createMagicToken(email: string, secret: string, ttlMs = 15 * 60_000): string {
  return sign(enc({ email: email.trim().toLowerCase(), exp: Date.now() + ttlMs }), secret);
}

/** Return the email if the token is valid and unexpired, else null. */
export function readMagicToken(token: string, secret: string, now = Date.now()): string | null {
  const payload = verify(token, secret);
  if (!payload) return null;
  try {
    const o = dec(payload) as { email?: unknown; exp?: unknown };
    return typeof o.email === 'string' && typeof o.exp === 'number' && o.exp > now ? o.email : null;
  } catch { return null; }
}

/** Session value carrying a userId, valid for ttlMs (default 30 days). */
export function createSession(userId: string, secret: string, ttlMs = 30 * 24 * 3600_000): string {
  return sign(enc({ userId, exp: Date.now() + ttlMs }), secret);
}

/** Return the userId if the session is valid and unexpired, else null. */
export function readSession(value: string, secret: string, now = Date.now()): string | null {
  const payload = verify(value, secret);
  if (!payload) return null;
  try {
    const o = dec(payload) as { userId?: unknown; exp?: unknown };
    return typeof o.userId === 'string' && typeof o.exp === 'number' && o.exp > now ? o.userId : null;
  } catch { return null; }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/auth-token.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/auth/token.ts test/auth-token.test.ts
git commit -m "feat(auth): add magic-link tokens and session values"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 3: Dependency-free cookie util

**Files:**
- Create: `src/auth/cookie.ts`
- Test: `test/auth-cookie.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/auth-cookie.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { serializeCookie, parseCookies } from '../src/auth/cookie.js';

describe('auth/cookie', () => {
  it('serialises with flags', () => {
    const c = serializeCookie('commons_session', 'abc', {
      httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 60,
    });
    expect(c).toContain('commons_session=abc');
    expect(c).toContain('Max-Age=60');
    expect(c).toContain('Path=/');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
  });

  it('url-encodes the value and round-trips via parse', () => {
    const c = serializeCookie('k', 'a b+c');
    expect(parseCookies(c.split(';')[0])).toEqual({ k: 'a b+c' });
  });

  it('parses multiple cookies', () => {
    expect(parseCookies('a=1; b=2')).toEqual({ a: '1', b: '2' });
  });

  it('returns empty for missing header', () => {
    expect(parseCookies(undefined)).toEqual({});
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/auth-cookie.test.ts`
Expected: FAIL — cannot find module `../src/auth/cookie.js`.

- [ ] **Step 3: Write the implementation**

Create `src/auth/cookie.ts`:
```ts
export interface CookieOpts {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  maxAge?: number; // seconds
}

/** Serialize a Set-Cookie header value. Dependency-free. */
export function serializeCookie(name: string, value: string, opts: CookieOpts = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  parts.push(`Path=${opts.path ?? '/'}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join('; ');
}

/** Parse a Cookie request header into a name->value map. */
export function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const k = pair.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/auth-cookie.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/auth/cookie.ts test/auth-cookie.test.ts
git commit -m "feat(auth): add dependency-free cookie serialize/parse"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 4: Pluggable mailer (console + Resend)

**Files:**
- Create: `src/auth/mailer.ts`
- Test: `test/auth-mailer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/auth-mailer.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { consoleMailer, resendMailer } from '../src/auth/mailer.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('auth/mailer', () => {
  it('console mailer does not throw', async () => {
    await expect(consoleMailer().send('a@x.com', 'subj', 'body')).resolves.toBeUndefined();
  });

  it('resend mailer POSTs the expected payload', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await resendMailer('key-123', 'noreply@commons.app').send('a@x.com', 'Hi', 'Body');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer key-123');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'noreply@commons.app', to: 'a@x.com', subject: 'Hi', text: 'Body',
    });
  });

  it('resend mailer throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 422 })));
    await expect(resendMailer('k', 'f@x.com').send('a@x.com', 's', 'b')).rejects.toThrow(/resend failed: 422/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/auth-mailer.test.ts`
Expected: FAIL — cannot find module `../src/auth/mailer.js`.

- [ ] **Step 3: Write the implementation**

Create `src/auth/mailer.ts`:
```ts
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Dev mailer: writes the message (incl. any magic-link) to stderr. */
export function consoleMailer(): Mailer {
  return {
    async send(to, subject, text) {
      process.stderr.write(`[mailer:console] to=${to} subject=${subject}\n${text}\n`);
    },
  };
}

/** Resend mailer over HTTP (no SDK). */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(to, subject, text) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!r.ok) throw new Error(`resend failed: ${r.status} ${await r.text()}`);
    },
  };
}

/** Pick a mailer from env: Resend if RESEND_API_KEY + MAIL_FROM are set, else console. */
export function mailerFromEnv(): Mailer {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  return key && from ? resendMailer(key, from) : consoleMailer();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/auth-mailer.test.ts`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/auth/mailer.ts test/auth-mailer.test.ts
git commit -m "feat(auth): add pluggable mailer (console + Resend over HTTP)"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 5: Auth routes plugin + `requireAuth`

Wire the primitives into Fastify: the magic-link request/callback flow, logout, an authenticated `me`, and a reusable `requireAuth` guard for 3b.

**Files:**
- Create: `src/auth/routes.ts`
- Test: `test/auth-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/auth-routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createDb } from '../src/db/index.js';
import { registerAuthRoutes } from '../src/auth/routes.js';
import type { Mailer } from '../src/auth/mailer.js';

const SECRET = 'test-secret';
const APP_URL = 'http://localhost:8787';

let app: FastifyInstance;
let db: ReturnType<typeof createDb>;
let sent: { to: string; subject: string; text: string }[];

beforeEach(async () => {
  db = createDb(':memory:');
  sent = [];
  const mailer: Mailer = { async send(to, subject, text) { sent.push({ to, subject, text }); } };
  app = Fastify();
  registerAuthRoutes(app, { db, secret: SECRET, appUrl: APP_URL, mailer });
  await app.ready();
});
afterEach(async () => { await app.close(); db.close(); });

const callbackPath = () => sent[0].text.match(/(\/api\/auth\/callback\?token=[^\s]+)/)![1];
const cookieFrom = (res: { headers: Record<string, unknown> }) => {
  const sc = res.headers['set-cookie'];
  const raw = Array.isArray(sc) ? sc[0] : (sc as string);
  return raw.split(';')[0]; // "commons_session=..."
};

describe('auth routes', () => {
  it('completes the magic-link flow for an invited email', async () => {
    db.addInvite('alice@example.com');

    const req = await app.inject({ method: 'POST', url: '/api/auth/request', payload: { email: 'Alice@Example.com' } });
    expect(req.statusCode).toBe(200);
    expect(sent.length).toBe(1);

    const cb = await app.inject({ method: 'GET', url: callbackPath() });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe(APP_URL + '/');

    // user + tenant provisioned on first login
    const user = db.getUserByEmail('alice@example.com');
    expect(user).toBeDefined();
    expect(db.getTenant(user!.tenant_id)).toBeDefined();

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieFrom(cb) } });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'alice@example.com', tenantId: user!.tenant_id });
  });

  it('does not send mail for a non-invited email but still returns 200', async () => {
    const req = await app.inject({ method: 'POST', url: '/api/auth/request', payload: { email: 'stranger@example.com' } });
    expect(req.statusCode).toBe(200);
    expect(sent.length).toBe(0);
  });

  it('rejects an invalid callback token', async () => {
    const cb = await app.inject({ method: 'GET', url: '/api/auth/callback?token=garbage' });
    expect(cb.statusCode).toBe(401);
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/auth-routes.test.ts`
Expected: FAIL — cannot find module `../src/auth/routes.js`.

- [ ] **Step 3: Write the implementation**

Create `src/auth/routes.ts`:
```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/types.js';
import type { Mailer } from './mailer.js';
import { generateId } from '../util/id.js';
import { createMagicToken, readMagicToken, createSession, readSession } from './token.js';
import { serializeCookie, parseCookies } from './cookie.js';

export interface AuthDeps {
  db: Db;
  secret: string;
  appUrl: string;
  mailer: Mailer;
}

const COOKIE = 'commons_session';

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

/** Register the magic-link auth routes on `app`. */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthDeps): void {
  const secure = deps.appUrl.startsWith('https');

  app.post('/api/auth/request', async (req, reply) => {
    const { email } = (req.body ?? {}) as { email?: string };
    if (!email || !email.includes('@')) return reply.code(400).send({ error: 'valid email required' });
    if (deps.db.isInvited(email)) {
      const token = createMagicToken(email, deps.secret);
      const link = `${deps.appUrl}/api/auth/callback?token=${encodeURIComponent(token)}`;
      await deps.mailer.send(
        email,
        'Your Commons sign-in link',
        `Sign in to Commons:\n${link}\n\nThis link expires in 15 minutes.`,
      );
    }
    return reply.send({ ok: true }); // generic — never leak invite status
  });

  app.get('/api/auth/callback', async (req, reply) => {
    const { token } = req.query as { token?: string };
    const email = token ? readMagicToken(token, deps.secret) : null;
    if (!email || !deps.db.isInvited(email)) return reply.code(401).send({ error: 'invalid or expired link' });

    let user = deps.db.getUserByEmail(email);
    if (!user) {
      const tenantId = generateId('t');
      deps.db.createTenant(tenantId);
      user = deps.db.createUser(email, tenantId);
    }
    deps.db.markInviteAccepted(email);

    const session = createSession(user.id, deps.secret);
    reply.header('set-cookie', serializeCookie(COOKIE, session, {
      httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 30 * 24 * 3600,
    }));
    return reply.code(302).header('location', deps.appUrl + '/').send();
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.header('set-cookie', serializeCookie(COOKIE, '', {
      httpOnly: true, secure, sameSite: 'Lax', path: '/', maxAge: 0,
    }));
    return reply.send({ ok: true });
  });

  const requireAuth = makeRequireAuth(deps);
  app.get('/api/auth/me', { preHandler: requireAuth }, async (req) => {
    const { userId, tenantId } = (req as FastifyRequest & { auth: { userId: string; tenantId: string } }).auth;
    const user = deps.db.getUserById(userId)!;
    return { userId, tenantId, email: user.email };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/auth-routes.test.ts`
Expected: PASS — 5 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/auth/routes.ts test/auth-routes.test.ts
git commit -m "feat(auth): add magic-link routes and requireAuth guard"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 6: Full-suite regression check

**Files:** none (verification + plan doc commit).

- [ ] **Step 1: Run the entire suite**

Run: `npm test`
Expected: PASS — previous 122 tests **plus** the new auth tests (4 + 5 + 4 + 3 + 5 = 21) = **143 tests**, 21 test files. If any previously-green test now fails, the change was not purely additive — investigate before proceeding.

- [ ] **Step 2: Commit the plan doc**

```bash
git add docs/superpowers/plans/2026-06-16-saas-auth-magic-link.md
git commit -m "docs(saas): add Step 3a auth subsystem plan"
```
(Append the `Co-Authored-By` trailer.)

> Note: do NOT tick build-order step 3 in SAAS_BETA_ARCHITECTURE.md yet — step 3 is complete only after 3b (enforcement + tenant rewiring of resource endpoints).

---

## Self-Review

**Spec coverage (vs ADR-3 "invite-only, magic-link, allowlist; httpOnly signed cookie"):**
- HMAC signing → Task 1 ✓ · magic token + session (TTLs) → Task 2 ✓ · cookie (httpOnly/SameSite/Secure) → Task 3 ✓ · mailer (Resend HTTP / dev console) → Task 4 ✓ · request/callback/logout/me + allowlist gate + first-login provisioning + `requireAuth` → Task 5 ✓ · generic 200 on request (no invite leak) → Task 5 ✓.

**Out of scope (3b, intentional):** applying `requireAuth` to resource routes; swapping the single engine for `EngineRegistry.forTenant(req.auth.tenantId)` + `scopeKey`; threading tenant into the agent runner; reading `COMMONS_AUTH_SECRET`/`COMMONS_APP_URL` in `main.ts`; updating `test/api.test.ts`. Stated in the scope guard. `makeRequireAuth` is exported now precisely so 3b can apply it.

**Placeholder scan:** none — every code/test step has complete content and exact commands.

**Type consistency:** `sign(payload, secret)`/`verify(signed, secret)` are used identically across `sign.ts`, `token.ts`, and tests. `createMagicToken`/`readMagicToken`/`createSession`/`readSession` signatures match between `token.ts` and `test/auth-token.test.ts`. `serializeCookie`/`parseCookies` match between `cookie.ts` and its test, and are consumed in `routes.ts`. `Mailer.send(to, subject, text)` is identical in `mailer.ts`, `routes.ts`, and both tests. `AuthDeps { db, secret, appUrl, mailer }` is the shape passed by `test/auth-routes.test.ts` to `registerAuthRoutes`. `request.auth = { userId, tenantId }` is set by `makeRequireAuth` and read by `/api/auth/me` — the same shape 3b will consume in resource routes.
```
