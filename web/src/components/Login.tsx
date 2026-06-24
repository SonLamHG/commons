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
