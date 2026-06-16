# Minimal Login UI (Step 3c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the web SPA a working invite-only sign-in flow so a real user can actually get past the auth gate added in Step 3b — an email → magic-link request screen, a session check on load, 401-aware data loading, and a sign-out control.

**Architecture:** Follow-on to Step 3b. The backend auth endpoints already exist (`POST /api/auth/request`, `GET /api/auth/callback`, `POST /api/auth/logout`, `GET /api/auth/me`). This step adds: (1) `api.auth.*` client calls + an `UnauthorizedError` thrown on HTTP 401; (2) a `Login` component matching the existing "Editorial Review Desk" theme; (3) an auth gate in `App` (loading → login → app) with a sign-out button. The magic link is delivered by the server's mailer — in dev (no `RESEND_API_KEY`) it is printed to the API process stderr (console mailer), so the developer copies the link from the terminal.

**Scope guard:** frontend only (`web/`), plus the one shared `api.ts`. No backend changes. Existing 147 backend tests stay green; a small co-located `web/src/api.test.ts` is added (node env, mocked `fetch` — the pattern used by `web/src/tree.test.ts`). The `Login`/`App` components are verified by `npm run build:web` (the project has no jsdom/component-test setup, so UI is not unit-tested — matching the current repo).

**Tech Stack:** React 19, Vite, TypeScript, Vitest (node env for the api test). Reuses existing CSS tokens/classes from `web/src/styles.css` (`--vermilion`, `.kicker`, `.newinput`, `.btn.approve`, `.empty`, `.period`).

---

### Task 1: Client auth calls + `UnauthorizedError`

**Files:**
- Modify: `web/src/api.ts`
- Test: `web/src/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `web/src/api.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { api, UnauthorizedError } from './api';

afterEach(() => { vi.restoreAllMocks(); });

describe('api.auth', () => {
  it('me() GETs /api/auth/me and returns the session', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ userId: 'u', tenantId: 't', email: 'a@x.com' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await api.auth.me()).toEqual({ userId: 'u', tenantId: 't', email: 'a@x.com' });
    expect(f.mock.calls[0][0]).toBe('/api/auth/me');
  });

  it('throws UnauthorizedError on HTTP 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(api.auth.me()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('request() POSTs the email', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await api.auth.request('a@x.com');
    expect(f.mock.calls[0][0]).toBe('/api/auth/request');
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({ email: 'a@x.com' });
  });

  it('logout() POSTs /api/auth/logout', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await api.auth.logout();
    expect(f.mock.calls[0][0]).toBe('/api/auth/logout');
    expect((f.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/src/api.test.ts`
Expected: FAIL — `UnauthorizedError` is not exported / `api.auth` is undefined.

- [ ] **Step 3: Write the implementation**

In `web/src/api.ts`, replace the `j` helper line:
```ts
const j = async (r: Response) => { if (!r.ok) throw new Error(await r.text()); return r.json(); };
```
with:
```ts
export class UnauthorizedError extends Error {
  constructor() { super('unauthorized'); this.name = 'UnauthorizedError'; }
}

const j = async (r: Response) => {
  if (r.status === 401) throw new UnauthorizedError();
  if (!r.ok) throw new Error(await r.text());
  return r.json();
};
```

Then, inside the `api` object, add an `auth` group immediately after the opening `export const api = {` line:
```ts
  auth: {
    me: (): Promise<{ userId: string; tenantId: string; email: string }> =>
      fetch('/api/auth/me').then(j),
    request: (email: string): Promise<{ ok: boolean }> =>
      fetch('/api/auth/request', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }),
      }).then(j),
    logout: (): Promise<{ ok: boolean }> =>
      fetch('/api/auth/logout', { method: 'POST' }).then(j),
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/src/api.test.ts`
Expected: PASS — 4 tests green.

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/api.test.ts
git commit -m "feat(web): add auth client calls and UnauthorizedError"
```
(Append the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.)

---

### Task 2: Login component + App auth gate + styles

**Files:**
- Create: `web/src/components/Login.tsx`
- Rewrite: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Create the Login component**

Create `web/src/components/Login.tsx`:
```tsx
import React, { useState } from 'react';
import { api } from '../api';

export function Login() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.auth.request(email.trim()); setSent(true); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="login-card">
        <span className="kicker">The Commons Review Desk</span>
        {sent ? (
          <>
            <h2 className="login-head">Check your inbox<span className="period">.</span></h2>
            <p className="login-lede">
              If <b>{email}</b> is on the guest list, a one-time sign-in link is on its way.
              It expires in 15 minutes.
            </p>
          </>
        ) : (
          <>
            <h2 className="login-head">Sign in<span className="period">.</span></h2>
            <p className="login-lede">
              Commons is invite-only during the beta. Enter your email and we’ll send a
              one-time sign-in link.
            </p>
            <form className="login-form" onSubmit={submit}>
              <input
                className="newinput" type="email" required autoFocus
                placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btn approve" type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Send link'}
              </button>
            </form>
            {error && <p className="empty" style={{ color: 'var(--vermilion)' }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `web/src/App.tsx`**

Replace the entire file with:
```tsx
import React, { useEffect, useState } from 'react';
import { api, UnauthorizedError, type Proposal } from './api';
import { ProposalList } from './components/ProposalList';
import { FileBrowser } from './components/FileBrowser';
import { AgentChat } from './components/AgentChat';
import { Login } from './components/Login';

export function App() {
  const [authStatus, setAuthStatus] = useState<'loading' | 'in' | 'out'>('loading');
  const [me, setMe] = useState<{ email: string } | null>(null);
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [ws, setWs] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'assistant' | 'proposals' | 'files'>('assistant');
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTemplate, setNewTemplate] = useState('content-calendar');
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    api.auth.me()
      .then((m) => { setMe({ email: m.email }); setAuthStatus('in'); })
      .catch(() => setAuthStatus('out'));
  }, []);

  const onAuthError = (e: unknown) => {
    if (e instanceof UnauthorizedError) { setAuthStatus('out'); return true; }
    return false;
  };

  const loadWorkspaces = () =>
    api.workspaces().then(setWorkspaces).catch((e) => {
      if (!onAuthError(e)) setError(e instanceof Error ? e.message : String(e));
    });
  useEffect(() => { if (authStatus === 'in') loadWorkspaces(); }, [authStatus]);

  const loadProposals = (w: string) => api.proposals(w).then(setProposals).catch(onAuthError);
  useEffect(() => { if (ws) { setTab('assistant'); loadProposals(ws); } }, [ws]);

  const logout = async () => {
    try { await api.auth.logout(); } finally { setAuthStatus('out'); setWs(null); setMe(null); }
  };

  const deleteWorkspace = async (w: string) => {
    if (!window.confirm(`Xóa workspace "${w}"?\nToàn bộ proposals và file sẽ bị xóa vĩnh viễn — không khôi phục được.`)) return;
    setError(null);
    try {
      await api.deleteWorkspace(w);
      if (ws === w) setWs(null);
      await loadWorkspaces();
    } catch (e) {
      if (!onAuthError(e)) setError(e instanceof Error ? e.message : String(e));
    }
  };

  const createWorkspace = async () => {
    setCreateError(null);
    try {
      await api.createWorkspace(newId.trim(), newTemplate);
      await loadWorkspaces();
      setWs(newId.trim());
      setTab('assistant');
      setCreating(false); setNewId('');
    } catch (e) {
      if (onAuthError(e)) return;
      const raw = e instanceof Error ? e.message : String(e);
      let msg = raw;
      try { msg = JSON.parse(raw).error ?? raw; } catch { /* keep raw */ }
      setCreateError(msg);
    }
  };

  if (authStatus === 'loading') {
    return (
      <div className="login">
        <div className="login-card">
          <span className="kicker">The Commons Review Desk</span>
          <p className="login-lede">Loading…</p>
        </div>
      </div>
    );
  }
  if (authStatus === 'out') return <Login />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Commons</h1>
        <h2>Workspaces</h2>
        <div className="ws-list">
          {workspaces.map((w) => (
            <div key={w} className="ws-row">
              <button className={w === ws ? 'ws active' : 'ws'} onClick={() => setWs(w)}>{w}</button>
              <button
                className="ws-del"
                title={`Xóa workspace ${w}`}
                aria-label={`Xóa workspace ${w}`}
                onClick={() => deleteWorkspace(w)}
              >×</button>
            </div>
          ))}
        </div>
        {error && <p className="empty" style={{ color: 'var(--vermilion)' }}>{error}</p>}
        {!creating && <button className="ws newbtn" onClick={() => setCreating(true)}>+ New workspace</button>}
        {creating && (
          <div className="newform">
            <input
              className="newinput"
              placeholder="id (a-z, 0-9, -)"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              autoFocus
            />
            <select className="newinput" value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
              <option value="content-calendar">Content calendar</option>
              <option value="blank">Blank</option>
            </select>
            <div className="newactions">
              <button className="btn approve" disabled={!newId.trim()} onClick={createWorkspace}>Create</button>
              <button className="btn" onClick={() => { setCreating(false); setCreateError(null); }}>Cancel</button>
            </div>
            {createError && <p className="empty" style={{ color: 'var(--vermilion)' }}>{createError}</p>}
          </div>
        )}
        <div className="colophon">
          <span className="colophon-rule" />
          <p>Agents propose · humans merge.<br />Branch <b>main</b> is the approved record.</p>
          {me && (
            <p className="account">
              {me.email}
              <button className="ws-del" title="Sign out" aria-label="Sign out" onClick={logout}>⎋</button>
            </p>
          )}
        </div>
      </aside>
      <main className="main">
        {ws ? (
          <>
            <div className="tabs">
              <button className={tab === 'assistant' ? 'tab active' : 'tab'} onClick={() => setTab('assistant')}>Assistant</button>
              <button className={tab === 'proposals' ? 'tab active' : 'tab'} onClick={() => setTab('proposals')}>Proposals</button>
              <button className={tab === 'files' ? 'tab active' : 'tab'} onClick={() => setTab('files')}>Files</button>
            </div>
            {tab === 'assistant'
              ? <AgentChat ws={ws} onDone={() => { setTab('proposals'); loadProposals(ws); }} />
              : tab === 'proposals'
                ? <ProposalList ws={ws} proposals={proposals} onChanged={() => loadProposals(ws)} />
                : <FileBrowser ws={ws} />}
          </>
        ) : (
          <div className="frontpage">
            <div className="frontpage-inner">
              <span className="kicker">The Commons Review Desk</span>
              <h2 className="frontpage-head">Nothing on the desk<span className="period">.</span></h2>
              <div className="dblrule"><span /><span /></div>
              <p className="frontpage-lede">
                Pick a workspace from the masthead to read its proposals, browse files,
                or hand work to the assistant. Every change waits here for your approval —
                nothing reaches <b>main</b> until you merge it.
              </p>
              <div className="frontpage-cues">
                <span><i className="dot indigo" /> Proposals await review</span>
                <span><i className="dot forest" /> You hold the merge</span>
                <span><i className="dot amber" /> Agents never touch main</span>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Add login styles**

Append to `web/src/styles.css`:
```css
/* ---------- Login / account ---------- */
.login { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.login-card {
  width: min(440px, 100%);
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: 10px;
  box-shadow: var(--shadow-md);
  padding: 36px 34px;
}
.login-head {
  font-family: var(--serif); font-weight: 600; font-size: 34px;
  letter-spacing: -.02em; margin: 10px 0 8px; line-height: 1.05;
}
.login-head .period { color: var(--vermilion); }
.login-lede { color: var(--ink-soft); font-size: 14.5px; line-height: 1.5; margin: 0 0 20px; }
.login-form { display: flex; flex-direction: column; gap: 12px; }
.account {
  margin-top: 12px; font-size: 11.5px; color: var(--ink-soft);
  display: flex; align-items: center; gap: 4px;
}
```

- [ ] **Step 4: Verify the web build compiles**

Run: `npm run build:web`
Expected: build succeeds (Vite outputs `web/dist` with no TypeScript/bundle errors). If it fails, fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/Login.tsx web/src/App.tsx web/src/styles.css web/dist
git commit -m "feat(web): invite-only login screen and auth gate"
```
(Append the `Co-Authored-By` trailer.)

---

### Task 3: Full-suite + ADR note

**Files:** Modify `SAAS_BETA_ARCHITECTURE.md`.

- [ ] **Step 1: Run the full suite**

Run: `npm test`
Expected: PASS — 147 backend tests **plus** 4 new `web/src/api.test.ts` tests = **151 tests**, 23 files.

- [ ] **Step 2: Note the login UI under step 3 in the architecture doc**

In [SAAS_BETA_ARCHITECTURE.md](../../../SAAS_BETA_ARCHITECTURE.md), under "Thứ tự xây", change the step 3 line:
```
3. ✅ **Auth invite-only** (ADR-3): magic-link + allowlist (3a) + middleware `requireAuth` + đóng mọi
   endpoint theo `tenantId` (3b).
```
to:
```
3. ✅ **Auth invite-only** (ADR-3): magic-link + allowlist (3a) + `requireAuth` + tenant-scope (3b) + web login UI (3c).
```

- [ ] **Step 3: Commit**

```bash
git add SAAS_BETA_ARCHITECTURE.md docs/superpowers/plans/2026-06-16-saas-login-ui.md
git commit -m "docs(saas): login UI (step 3c) complete"
```
(Append the `Co-Authored-By` trailer.)

---

## Self-Review

**Spec coverage:** session check on load (`api.auth.me` in `App` mount) ✓ · email → magic-link request screen (`Login`) ✓ · 401-aware loads (`onAuthError` → `setAuthStatus('out')`) ✓ · sign-out (`logout`) ✓ · theme consistency (reuses `.kicker`/`.newinput`/`.btn.approve`/`.period` + new `.login-*` tokens) ✓.

**Out of scope:** styled HTML email template (dev uses console mailer; plain-text link is fine); "resend link" / rate-limit UX; remembering intended destination after login. None block the beta sign-in loop.

**Placeholder scan:** none — full file contents + exact commands.

**Type/shape consistency:** `api.auth.me()` returns `{ userId, tenantId, email }` (matches backend `/api/auth/me` in `src/auth/routes.ts`) and `App` reads `m.email`. `UnauthorizedError` is exported from `api.ts` and imported by `App.tsx`. `api.auth.request(email)`/`api.auth.logout()` match `Login` and `App` call sites. The `j` helper now throws `UnauthorizedError` on 401 for every existing `api.*` call, so `onAuthError` catches expired sessions uniformly.
```
