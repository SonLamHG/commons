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
