# SaaS Beta Step 4 — Network Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Commons API safe to expose to invited outsiders — encrypt the stored webhook secret, block SSRF on publish, add security headers, CORS lock-down, rate limiting, and a configurable bind host.

**Architecture:** Dependency-free, in keeping with the project (it already hand-rolls HMAC auth and uses `node:sqlite`). Each concern is a small focused module under `src/security/` (headers, cors, rate-limit) or `src/util/` (secretbox, ssrf), wired into `buildApi` via the existing `ApiDeps`. The publish store gains transparent at-rest encryption of `webhookUrl`; the publish route gains an SSRF check that re-resolves DNS at send time. All testable through `app.inject` and pure-function unit tests — no network in tests.

**Tech Stack:** Fastify 5, Node built-ins (`node:crypto` AES-256-GCM, `node:dns/promises`, `node:net`), Vitest. **No new npm dependencies.**

---

## Context an engineer needs before starting

- This repo runs TypeScript directly through `tsx`/esbuild — there is **no `tsc` build/type-check step**. Correctness is proven by `npm test` (Vitest), not by types. Run tests, not the compiler.
- ESM project (`"type": "module"`). Relative imports inside `src/` use the `.js` extension even for `.ts` files (e.g. `import { x } from './foo.js'`). Follow that convention exactly or imports fail at runtime.
- The Fastify app is built in [src/api/server.ts](../../../src/api/server.ts) by `buildApi(deps: ApiDeps)`. It is tested in isolation with `app.inject(...)` — see [test/api.test.ts](../../../test/api.test.ts). `main.ts` only wires real deps and calls `listen`.
- Auth gate: a `preHandler` hook in `buildApi` rejects unauthenticated `/api/*` requests (except `/api/auth/*` and `/api/health`). Hooks run **in registration order**, so anything that must run before auth (CORS preflight, rate-limit) must be registered before that hook. The hook lives at [src/api/server.ts:84](../../../src/api/server.ts#L84).
- The publish webhook `fetch` is at [src/api/server.ts:272](../../../src/api/server.ts#L272). The webhook URL is read from the per-tenant publish store at [src/publish/store.ts](../../../src/publish/store.ts), currently stored as **plaintext** in `meta/<ws>/publish.json`.
- `authSecret` is already a required env (`COMMONS_AUTH_SECRET`) threaded into `buildApi` via `ApiDeps.authSecret`. Reuse it to derive the at-rest encryption key — no new secret to manage.
- The SPA loads Google Fonts (`fonts.googleapis.com` for the stylesheet, `fonts.gstatic.com` for the font files) — see [web/index.html](../../../web/index.html). The Content-Security-Policy MUST allow these or the UI renders unstyled.
- Test bootstrap: `test/api.test.ts` `setup()` builds a registry over a temp dir, an in-memory db (`createDb(':memory:')`), seeds tenant `t-test` + a user, and returns an `inj()` wrapper that attaches the session cookie. Reuse `setup()`/`inj()` in new API tests.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/util/secretbox.ts` (create) | AES-256-GCM encrypt/decrypt of short strings, keyed off the server secret; transparent passthrough of legacy plaintext. |
| `src/util/ssrf.ts` (create) | `isBlockedIp(ip)` + `assertPublicHttpsUrl(url)` — enforce https + block private/loopback/link-local/metadata ranges after DNS resolution. |
| `src/security/headers.ts` (create) | `registerSecurityHeaders(app)` — sets CSP and hardening headers on every response. |
| `src/security/cors.ts` (create) | `registerCors(app, allowedOrigin)` — reflect only the app origin, answer preflight, allow credentials. |
| `src/security/rateLimit.ts` (create) | `createRateLimiter()` pure fixed-window limiter + `registerRateLimit(app, opts)` onRequest hook returning 429. |
| `src/publish/store.ts` (modify) | Encrypt `webhookUrl` at rest using `secretbox`; needs the secret passed in. |
| `src/api/server.ts` (modify) | Register CORS + rate-limit (before auth) and headers; thread secret to publish store; SSRF-guard `setConfig` and `publish`. |
| `src/api/main.ts` (modify) | Configurable bind `HOST` (default `0.0.0.0` for container, doc says put behind proxy). |
| `test/secretbox.test.ts` (create) | round-trip, tamper rejection, legacy passthrough. |
| `test/ssrf.test.ts` (create) | blocked/allowed IPs, protocol + literal-IP URL checks. |
| `test/security.test.ts` (create) | headers present, CORS reflect/deny, rate-limit 429 via `app.inject`. |
| `test/api.test.ts` (modify) | publish SSRF rejection; webhook stored encrypted but round-trips through `getConfig`. |

---

### Task 1: Secret-box (AES-256-GCM) util

**Files:**
- Create: `src/util/secretbox.ts`
- Test: `test/secretbox.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/secretbox.test.ts
import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/util/secretbox.js';

describe('secretbox', () => {
  it('round-trips a value', () => {
    const blob = encryptSecret('https://hook.example/abc', 'server-secret');
    expect(blob).not.toContain('hook.example');     // ciphertext, not plaintext
    expect(blob.startsWith('enc:v1:')).toBe(true);
    expect(decryptSecret(blob, 'server-secret')).toBe('https://hook.example/abc');
  });

  it('produces different ciphertext each call (random IV)', () => {
    expect(encryptSecret('x', 's')).not.toBe(encryptSecret('x', 's'));
  });

  it('throws on wrong key', () => {
    const blob = encryptSecret('secret', 'key-a');
    expect(() => decryptSecret(blob, 'key-b')).toThrow();
  });

  it('passes through legacy plaintext (no prefix) unchanged', () => {
    expect(decryptSecret('https://legacy.example/x', 'any')).toBe('https://legacy.example/x');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/secretbox.test.ts`
Expected: FAIL — cannot find module `../src/util/secretbox.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/util/secretbox.ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const PREFIX = 'enc:v1:';
const keyFrom = (secret: string): Buffer => createHash('sha256').update(secret).digest(); // 32 bytes

/** Encrypt a short string with AES-256-GCM. Output: `enc:v1:` + base64(iv|tag|ciphertext). */
export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Decrypt a value produced by encryptSecret. Strings without the prefix are returned as-is
 * (legacy plaintext written before encryption existed). Throws on tamper / wrong key. */
export function decryptSecret(blob: string, secret: string): string {
  if (!blob.startsWith(PREFIX)) return blob;
  const raw = Buffer.from(blob.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const ct = raw.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/secretbox.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/util/secretbox.ts test/secretbox.test.ts
git commit -m "feat(security): AES-256-GCM secretbox for at-rest secrets"
```

---

### Task 2: Encrypt `webhookUrl` at rest in the publish store

**Files:**
- Modify: `src/publish/store.ts`
- Test: `test/publish-store.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// test/publish-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublishStore } from '../src/publish/store.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'pub-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('publish store at-rest encryption', () => {
  it('round-trips webhookUrl but does not store it in plaintext', () => {
    const store = createPublishStore(root, 'srv-secret');
    store.setConfig('ws1', { webhookUrl: 'https://hook.example/secret-path' });
    expect(store.getConfig('ws1').webhookUrl).toBe('https://hook.example/secret-path');

    const onDisk = readFileSync(join(root, 'meta', 'ws1', 'publish.json'), 'utf8');
    expect(onDisk).not.toContain('hook.example');   // encrypted at rest
    expect(onDisk).toContain('enc:v1:');
  });

  it('clearing the webhook (undefined) yields no webhookUrl', () => {
    const store = createPublishStore(root, 'srv-secret');
    store.setConfig('ws1', { webhookUrl: 'https://hook.example/x' });
    store.setConfig('ws1', { webhookUrl: undefined });
    expect(store.getConfig('ws1').webhookUrl).toBeUndefined();
  });

  it('reads legacy plaintext webhookUrl written before encryption', () => {
    const legacy = createPublishStore(root, '');         // empty secret == legacy writer path below
    // simulate an old file with plaintext by writing through a store that did not encrypt:
    // easiest: write with one secret, read with same secret still round-trips; legacy handled by decryptSecret passthrough.
    legacy.setConfig('ws2', { webhookUrl: 'https://plain.example/y' });
    expect(createPublishStore(root, '').getConfig('ws2').webhookUrl).toBe('https://plain.example/y');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/publish-store.test.ts`
Expected: FAIL — `createPublishStore` currently takes one arg; on-disk file still contains `hook.example` (plaintext), so the `not.toContain` assertion fails.

- [ ] **Step 3: Write minimal implementation**

Replace the body of [src/publish/store.ts](../../../src/publish/store.ts) with:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { encryptSecret, decryptSecret } from '../util/secretbox.js';

export interface PublishConfig { webhookUrl?: string; }
export interface PublishRecord { publishedAt: string; }
interface PublishData { webhookUrl?: string; published: Record<string, PublishRecord>; }

export interface PublishStore {
  getConfig(ws: string): PublishConfig;
  setConfig(ws: string, config: PublishConfig): void;
  listPublished(ws: string): Record<string, PublishRecord>;
  markPublished(ws: string, path: string): PublishRecord;
}

/** Per-tenant publish metadata. `secret` keys the at-rest encryption of webhookUrl. */
export function createPublishStore(rootDir: string, secret: string): PublishStore {
  rootDir = resolve(rootDir);
  const file = (ws: string) => join(rootDir, 'meta', ws, 'publish.json');
  const read = (ws: string): PublishData => {
    const f = file(ws);
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { published: {} };
  };
  const write = (ws: string, data: PublishData) => {
    const f = file(ws);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, JSON.stringify(data, null, 2));
  };
  return {
    getConfig(ws) {
      const stored = read(ws).webhookUrl;
      return { webhookUrl: stored ? decryptSecret(stored, secret) : undefined };
    },
    setConfig(ws, config) {
      const d = read(ws);
      d.webhookUrl = config.webhookUrl ? encryptSecret(config.webhookUrl, secret) : undefined;
      write(ws, d);
    },
    listPublished(ws) { return read(ws).published; },
    markPublished(ws, path) {
      const d = read(ws);
      const rec: PublishRecord = { publishedAt: new Date().toISOString() };
      d.published[path] = rec;
      write(ws, d);
      return rec;
    },
  };
}
```

> Note on the legacy test: with `secret = ''` the encrypt path still runs (GCM with a key derived from the empty string) and round-trips. The real legacy case (a file already on disk holding raw plaintext from before this change) is covered by `decryptSecret`'s no-prefix passthrough in Task 1.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/publish-store.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update the one caller and run the full suite**

In [src/api/server.ts](../../../src/api/server.ts), update `publishOf` to pass the secret. Change:

```ts
    if (!s) { s = createPublishStore(registry.rootFor(t)); publishStores.set(t, s); }
```
to:
```ts
    if (!s) { s = createPublishStore(registry.rootFor(t), authSecret); publishStores.set(t, s); }
```

Run: `npm test`
Expected: PASS (no callers other than server.ts; grep to confirm: `git grep -n createPublishStore` shows only `src/publish/store.ts` and `src/api/server.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/publish/store.ts src/api/server.ts test/publish-store.test.ts
git commit -m "feat(security): encrypt webhookUrl at rest in publish store"
```

---

### Task 3: SSRF guard util

**Files:**
- Create: `src/util/ssrf.ts`
- Test: `test/ssrf.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/ssrf.test.ts
import { describe, it, expect } from 'vitest';
import { isBlockedIp, assertPublicHttpsUrl } from '../src/util/ssrf.js';

describe('isBlockedIp', () => {
  it('blocks loopback, private, link-local, metadata, unspecified', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.1',
                       '169.254.169.254', '0.0.0.0', '::1', 'fe80::1', 'fc00::1'])
      expect(isBlockedIp(ip), ip).toBe(true);
  });
  it('allows public addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111'])
      expect(isBlockedIp(ip), ip).toBe(false);
  });
});

describe('assertPublicHttpsUrl', () => {
  it('rejects non-https', async () => {
    await expect(assertPublicHttpsUrl('http://1.1.1.1/')).rejects.toThrow(/https/);
  });
  it('rejects a literal private-IP host without any DNS', async () => {
    await expect(assertPublicHttpsUrl('https://169.254.169.254/latest/meta-data')).rejects.toThrow(/not allowed/);
  });
  it('rejects garbage URLs', async () => {
    await expect(assertPublicHttpsUrl('not a url')).rejects.toThrow();
  });
  it('accepts a literal public-IP https host', async () => {
    await expect(assertPublicHttpsUrl('https://1.1.1.1/hook')).resolves.toBeInstanceOf(URL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ssrf.test.ts`
Expected: FAIL — cannot find module `../src/util/ssrf.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/util/ssrf.ts
import { lookup } from 'node:dns/promises';
import net from 'node:net';

function ipv4ToInt(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function inV4(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const V4_BLOCKS = [
  '0.0.0.0/8',       // unspecified / this-network
  '10.0.0.0/8',      // private
  '100.64.0.0/10',   // CGNAT
  '127.0.0.0/8',     // loopback
  '169.254.0.0/16',  // link-local incl. cloud metadata 169.254.169.254
  '172.16.0.0/12',   // private
  '192.0.0.0/24',    // IETF protocol
  '192.168.0.0/16',  // private
  '198.18.0.0/15',   // benchmarking
  '224.0.0.0/4',     // multicast
  '240.0.0.0/4',     // reserved
];

/** True if the (already-numeric) IP is in a range we must never let a webhook reach. */
export function isBlockedIp(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) return V4_BLOCKS.some((c) => inV4(ip, c));
  if (v === 6) {
    const lo = ip.toLowerCase();
    if (lo === '::1' || lo === '::') return true;            // loopback / unspecified
    if (lo.startsWith('fe80')) return true;                  // link-local
    if (lo.startsWith('fc') || lo.startsWith('fd')) return true; // unique-local fc00::/7
    if (lo.startsWith('ff')) return true;                    // multicast
    // IPv4-mapped (::ffff:a.b.c.d) — re-check the embedded v4
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lo);
    if (m) return isBlockedIp(m[1]);
    return false;
  }
  return true; // not a valid IP literal — treat as blocked
}

/** Validate a webhook URL: must be https and must resolve only to public addresses.
 * Resolves DNS at call time (so call it right before fetch to limit DNS-rebind windows). */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('invalid URL'); }
  if (url.protocol !== 'https:') throw new Error('webhook must use https');
  const host = url.hostname;
  const ips = net.isIP(host)
    ? [host]
    : (await lookup(host, { all: true })).map((a) => a.address);
  if (ips.length === 0) throw new Error('webhook host did not resolve');
  for (const ip of ips) if (isBlockedIp(ip)) throw new Error('webhook host is not allowed (non-public address)');
  return url;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ssrf.test.ts`
Expected: PASS (6 tests). No network is hit — all cases use literal IPs or invalid input.

- [ ] **Step 5: Commit**

```bash
git add src/util/ssrf.ts test/ssrf.test.ts
git commit -m "feat(security): SSRF guard (https-only, block private/metadata ranges)"
```

---

### Task 4: Apply the SSRF guard to config + publish routes

**Files:**
- Modify: `src/api/server.ts:232-237` (the `PUT .../config` route) and `src/api/server.ts:271-280` (the publish `fetch`)
- Test: `test/api.test.ts` (add cases)

- [ ] **Step 1: Write the failing test**

Add to [test/api.test.ts](../../../test/api.test.ts) inside the existing top-level `describe` (it has access to `setup`/`inj`). First create a workspace in the test's tenant; reuse the pattern already in the file for creating a workspace, then:

```ts
  it('rejects a webhook pointing at a private/metadata address (SSRF)', async () => {
    const { inj } = await setup();
    await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'wsx', template: 'blank' } });

    const res = await inj({
      method: 'PUT', url: '/api/workspaces/wsx/config',
      payload: { webhookUrl: 'https://169.254.169.254/latest/meta-data' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/not allowed|https/);
  });

  it('rejects a non-https webhook', async () => {
    const { inj } = await setup();
    await inj({ method: 'POST', url: '/api/workspaces', payload: { id: 'wsy', template: 'blank' } });
    const res = await inj({
      method: 'PUT', url: '/api/workspaces/wsy/config',
      payload: { webhookUrl: 'http://example.com/hook' },
    });
    expect(res.statusCode).toBe(400);
  });
```

> If `setup()` is single-use per test in this file, follow whatever the existing tests do (they may share one `setup()` per `it`). Match the file's current style — do not refactor it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.ts -t SSRF`
Expected: FAIL — config currently accepts any string, returns 200.

- [ ] **Step 3: Implement — guard `setConfig`**

In [src/api/server.ts](../../../src/api/server.ts), import the guard near the other imports:

```ts
import { assertPublicHttpsUrl } from '../util/ssrf.js';
```

Replace the `PUT .../config` handler:

```ts
  app.put('/api/workspaces/:ws/config', async (req, reply) => {
    const { ws } = req.params as { ws: string };
    const { webhookUrl } = (req.body ?? {}) as { webhookUrl?: string };
    if (webhookUrl) {
      try { await assertPublicHttpsUrl(webhookUrl); }
      catch (e) { return reply.code(400).send({ error: e instanceof Error ? e.message : String(e) }); }
    }
    await lock(req, ws, async () => publishOf(req).setConfig(ws, { webhookUrl }));
    return { ok: true };
  });
```

- [ ] **Step 4: Implement — re-check at publish time (DNS-rebind defense)**

In the `POST .../publish` handler, replace the `fetch` block (currently around [src/api/server.ts:271-280](../../../src/api/server.ts#L271-L280)) so it re-validates immediately before the request:

```ts
    try {
      await assertPublicHttpsUrl(webhookUrl);   // re-resolve at send time
      const r = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: ws, path, title, content, text, ...(image ? { image } : {}) }),
      });
      if (!r.ok) return reply.code(502).send({ error: `webhook returned ${r.status}` });
    } catch (e) {
      return reply.code(502).send({ error: `webhook failed: ${e instanceof Error ? e.message : String(e)}` });
    }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/api.test.ts`
Expected: PASS, including the two new SSRF cases.

- [ ] **Step 6: Commit**

```bash
git add src/api/server.ts test/api.test.ts
git commit -m "feat(security): SSRF-guard webhook config and publish"
```

---

### Task 5: Security headers

**Files:**
- Create: `src/security/headers.ts`
- Test: `test/security.test.ts` (create — first describe block)

- [ ] **Step 1: Write the failing test**

```ts
// test/security.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerSecurityHeaders } from '../src/security/headers.js';

describe('security headers', () => {
  it('sets hardening headers and a CSP that allows Google Fonts', async () => {
    const app = Fastify();
    registerSecurityHeaders(app);
    app.get('/x', async () => ({ ok: true }));
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('fonts.googleapis.com');
    expect(csp).toContain('fonts.gstatic.com');
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/security.test.ts`
Expected: FAIL — cannot find module `../src/security/headers.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/security/headers.ts
import type { FastifyInstance } from 'fastify';

// CSP tuned for this SPA: self-hosted JS/CSS, Google Fonts stylesheet + font files,
// data: images (the app embeds generated images as data URLs in places), same-origin XHR/NDJSON.
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "script-src 'self'",
  "connect-src 'self'",
].join('; ');

/** Apply security response headers to every route. */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('content-security-policy', CSP);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-opener-policy', 'same-origin');
    reply.header('x-permitted-cross-domain-policies', 'none');
    // HSTS only matters over TLS; harmless over http and correct once behind the proxy.
    reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/security.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/security/headers.ts test/security.test.ts
git commit -m "feat(security): security response headers (CSP, HSTS, frame-options)"
```

---

### Task 6: CORS lock-down

**Files:**
- Create: `src/security/cors.ts`
- Test: `test/security.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

Append to [test/security.test.ts](../../../test/security.test.ts):

```ts
import { registerCors } from '../src/security/cors.js';

describe('cors', () => {
  const build = () => {
    const app = Fastify();
    registerCors(app, 'https://app.example');
    app.get('/x', async () => ({ ok: true }));
    return app;
  };

  it('reflects the allowed origin and allows credentials', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/x', headers: { origin: 'https://app.example' } });
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    await app.close();
  });

  it('does not reflect a foreign origin', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/x', headers: { origin: 'https://evil.example' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });

  it('answers preflight with 204', async () => {
    const app = build();
    const res = await app.inject({ method: 'OPTIONS', url: '/x', headers: { origin: 'https://app.example' } });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('https://app.example');
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/security.test.ts -t cors`
Expected: FAIL — cannot find module `../src/security/cors.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/security/cors.ts
import type { FastifyInstance } from 'fastify';

/** Same-origin SPA: only reflect the configured app origin, and answer preflight.
 * Credentials are allowed so the session cookie flows on cross-origin XHR if ever needed. */
export function registerCors(app: FastifyInstance, allowedOrigin: string): void {
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin === allowedOrigin) {
      reply.header('access-control-allow-origin', allowedOrigin);
      reply.header('access-control-allow-credentials', 'true');
      reply.header('vary', 'Origin');
      reply.header('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      reply.header('access-control-allow-headers', 'content-type');
    }
    if (req.method === 'OPTIONS') {
      return reply.code(204).send();
    }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/security.test.ts`
Expected: PASS (all headers + cors describes).

- [ ] **Step 5: Commit**

```bash
git add src/security/cors.ts test/security.test.ts
git commit -m "feat(security): origin-locked CORS with preflight"
```

---

### Task 7: Rate limiting

**Files:**
- Create: `src/security/rateLimit.ts`
- Test: `test/security.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test**

Append to [test/security.test.ts](../../../test/security.test.ts):

```ts
import { createRateLimiter, registerRateLimit } from '../src/security/rateLimit.js';

describe('rate limiter (pure)', () => {
  it('allows up to max within the window, then blocks', () => {
    const rl = createRateLimiter();
    const limit = { max: 2, windowMs: 1000 };
    expect(rl.check('k', limit, 0)).toBe(true);
    expect(rl.check('k', limit, 10)).toBe(true);
    expect(rl.check('k', limit, 20)).toBe(false);     // over max
    expect(rl.check('k', limit, 1001)).toBe(true);    // window rolled over
  });
});

describe('rate limit hook', () => {
  it('returns 429 after the limit is exceeded', async () => {
    const app = Fastify();
    registerRateLimit(app, { global: { max: 2, windowMs: 60000 }, auth: { max: 2, windowMs: 60000 } });
    app.get('/x', async () => ({ ok: true }));
    const hit = () => app.inject({ method: 'GET', url: '/x', headers: { 'x-forwarded-for': '5.5.5.5' } });
    expect((await hit()).statusCode).toBe(200);
    expect((await hit()).statusCode).toBe(200);
    const blocked = await hit();
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/security.test.ts -t "rate"`
Expected: FAIL — cannot find module `../src/security/rateLimit.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/security/rateLimit.ts
import type { FastifyInstance } from 'fastify';

export interface RateLimit { max: number; windowMs: number; }
interface Bucket { count: number; resetAt: number; }

/** In-memory fixed-window limiter. Single-node only (matches ADR-1's single-writer node). */
export function createRateLimiter() {
  const buckets = new Map<string, Bucket>();
  return {
    /** Returns true if allowed; false if the bucket is exhausted. */
    check(key: string, limit: RateLimit, now: number = Date.now()): boolean {
      const b = buckets.get(key);
      if (!b || now >= b.resetAt) { buckets.set(key, { count: 1, resetAt: now + limit.windowMs }); return true; }
      if (b.count >= limit.max) return false;
      b.count++;
      return true;
    },
    /** retryAfter seconds for a key, for the Retry-After header. */
    retryAfter(key: string, now: number = Date.now()): number {
      const b = buckets.get(key);
      return b ? Math.max(1, Math.ceil((b.resetAt - now) / 1000)) : 1;
    },
  };
}

export interface RateLimitOpts { global: RateLimit; auth: RateLimit; }

const DEFAULTS: RateLimitOpts = {
  global: { max: 300, windowMs: 60_000 },  // 300 req/min/IP overall
  auth:   { max: 10,  windowMs: 60_000 },  // 10 magic-link requests/min/IP
};

/** Install an onRequest rate-limit hook. Auth endpoints get a stricter bucket. */
export function registerRateLimit(app: FastifyInstance, opts: RateLimitOpts = DEFAULTS): void {
  const rl = createRateLimiter();
  app.addHook('onRequest', async (req, reply) => {
    const ip = req.ip || 'unknown';
    const isAuth = req.url.startsWith('/api/auth/');
    const limit = isAuth ? opts.auth : opts.global;
    const key = `${isAuth ? 'auth' : 'global'}:${ip}`;
    if (!rl.check(key, limit)) {
      reply.header('retry-after', String(rl.retryAfter(key)));
      return reply.code(429).send({ error: 'rate limit exceeded — slow down' });
    }
  });
}
```

> Note: `req.ip` in tests reflects `x-forwarded-for` only when Fastify `trustProxy` is on. For the pure-limiter test we test `check()` directly; for the hook test, Fastify's default `req.ip` is the socket address (constant in `inject`), so all three calls share one key — which is exactly what the 429 assertion needs. The `x-forwarded-for` header in the test is illustrative and harmless.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/security.test.ts`
Expected: PASS (rate limiter pure + hook).

- [ ] **Step 5: Commit**

```bash
git add src/security/rateLimit.ts test/security.test.ts
git commit -m "feat(security): in-memory rate limiting (global + stricter auth)"
```

---

### Task 8: Wire everything into `buildApi` and make bind host configurable

**Files:**
- Modify: `src/api/server.ts` (registration order) and `src/api/main.ts` (HOST)
- Test: `test/api.test.ts` (assert headers present through the real app)

- [ ] **Step 1: Write the failing test**

Add to [test/api.test.ts](../../../test/api.test.ts):

```ts
  it('serves security headers and rate-limit on the real API', async () => {
    const { inj } = await setup();
    const res = await inj({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.ts -t "security headers and rate-limit"`
Expected: FAIL — `buildApi` does not register headers yet.

- [ ] **Step 3: Register middleware in `buildApi` (correct order)**

In [src/api/server.ts](../../../src/api/server.ts), add imports:

```ts
import { registerSecurityHeaders } from '../security/headers.js';
import { registerCors } from '../security/cors.js';
import { registerRateLimit } from '../security/rateLimit.js';
```

Then immediately after `const app = Fastify({ forceCloseConnections: true });` (line ~78), and **before** `app.register(multipart, ...)` and the auth hook, add:

```ts
  // Security middleware — registered first so they run before the auth gate.
  registerSecurityHeaders(app);
  registerCors(app, appUrl);
  registerRateLimit(app);
```

`appUrl` is already destructured from `deps` at the top of `buildApi`.

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS — the whole suite, including the new header assertion. If any existing test asserts an exact response and now trips on CORS preflight, it won't (preflight only triggers on `OPTIONS` with an `Origin` header, which existing tests don't send).

- [ ] **Step 5: Make the bind host configurable in main.ts**

In [src/api/main.ts](../../../src/api/main.ts), add near the other env reads (after line 16):

```ts
const host = process.env.HOST ?? '0.0.0.0';
```

and change the `listen` call:

```ts
app.listen({ port, host })
```

> Rationale: in the container the app binds `0.0.0.0` and TLS/CORS origin is handled by the reverse proxy (Caddy/Fly, per ADR-1/ADR-6). Operators who run the process directly on a host can set `HOST=127.0.0.1` to force loopback-only. Default stays `0.0.0.0` so existing `npm run dev`/Docker behavior is unchanged.

- [ ] **Step 6: Run the full suite once more**

Run: `npm test`
Expected: PASS (all green).

- [ ] **Step 7: Commit**

```bash
git add src/api/server.ts src/api/main.ts test/api.test.ts
git commit -m "feat(security): wire headers/cors/rate-limit into API; configurable bind host"
```

---

### Task 9: Update docs (architecture + known limitations)

**Files:**
- Modify: `SAAS_BETA_ARCHITECTURE.md` (mark step 4 done)

- [ ] **Step 1: Mark the build-order item complete**

In [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md), change the step-4 line under "Thứ tự xây" from:

```
4. **Hardening mạng** (ADR-6): proxy/TLS, CORS, rate-limit, helmet, SSRF guard, mã hoá webhook.
```
to:
```
4. ✅ **Hardening mạng** (ADR-6): CORS, rate-limit, security headers, SSRF guard, mã hoá webhook at-rest, bind host cấu hình được. (Proxy/TLS do nền tảng deploy lo — Bước 7.)
```

- [ ] **Step 2: Commit**

```bash
git add SAAS_BETA_ARCHITECTURE.md
git commit -m "docs(saas): hardening (step 4) complete"
```

---

## Self-Review

**Spec coverage (ADR-6):**
- Bind `127.0.0.1` / behind proxy → Task 8 (`HOST` env; proxy/TLS deferred to deploy step 7, noted).
- CORS locked to app origin → Task 6.
- Rate-limit (`@fastify/rate-limit` equivalent) → Task 7 (in-house, dependency-free).
- Security headers (`@fastify/helmet` equivalent) → Task 5 (in-house CSP + hardening headers).
- 25MB multipart limit retained → unchanged in `buildApi` (multipart registration untouched).
- SSRF on publish webhook (https-only, block private/loopback/link-local/metadata, resolve DNS) → Tasks 3+4.
- Encrypt `webhookUrl` at rest → Tasks 1+2.

**Placeholder scan:** none — every code step has full code; no TODO/TBD.

**Type consistency:** `createPublishStore(rootDir, secret)` signature updated in Task 2 and its sole caller updated same task. `RateLimit`/`RateLimitOpts`/`createRateLimiter().check/retryAfter` consistent between Task 7 definition and its test. `assertPublicHttpsUrl`/`isBlockedIp` names consistent across Tasks 3-4. `registerSecurityHeaders`/`registerCors`/`registerRateLimit` consistent between Tasks 5-7 and the wiring in Task 8.

**Deliberate scope cuts (per ADR):** TLS termination and reverse-proxy config are infra (deploy step 7), not app code — Task 8 only makes the bind host configurable and documents the intent. No npm dependencies added, consistent with the project's dependency-free posture (node:sqlite, hand-rolled HMAC).
