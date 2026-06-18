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
        <span className="kicker">Bàn duyệt Commons</span>
        {sent ? (
          <>
            <h2 className="login-head">Kiểm tra hộp thư<span className="period">.</span></h2>
            <p className="login-lede">
              Nếu <b>{email}</b> nằm trong danh sách mời, một liên kết đăng nhập dùng một lần
              đang được gửi tới. Liên kết hết hạn sau 15 phút.
            </p>
          </>
        ) : (
          <>
            <h2 className="login-head">Đăng nhập<span className="period">.</span></h2>
            <p className="login-lede">
              Commons đang trong giai đoạn beta theo lời mời. Nhập email của bạn, chúng tôi sẽ gửi
              một liên kết đăng nhập dùng một lần.
            </p>
            <form className="login-form" onSubmit={submit}>
              <input
                className="newinput" type="email" required autoFocus
                placeholder="you@example.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btn approve" type="submit" disabled={busy || !email.trim()}>
                {busy ? 'Đang gửi…' : 'Gửi liên kết'}
              </button>
            </form>
            {error && <p className="notice notice--error" role="alert">{error}</p>}
          </>
        )}
      </div>
    </div>
  );
}
