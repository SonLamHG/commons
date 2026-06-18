import React, { useEffect, useState } from 'react';
import { api, UnauthorizedError, type Proposal } from './api';
import { ProposalList } from './components/ProposalList';
import { FileBrowser } from './components/FileBrowser';
import { AgentChat } from './components/AgentChat';
import { Login } from './components/Login';
import { ConfirmDialog, type ConfirmRequest } from './components/ConfirmDialog';

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
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    api.auth.session()
      .then((s) => {
        if (s.authenticated) { setMe({ email: s.email }); setAuthStatus('in'); }
        else setAuthStatus('out');
      })
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

  const doDeleteWorkspace = async (w: string) => {
    setError(null);
    try {
      await api.deleteWorkspace(w);
      if (ws === w) setWs(null);
      await loadWorkspaces();
    } catch (e) {
      if (!onAuthError(e)) setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteWorkspace = (w: string) => {
    setConfirm({
      title: `Xóa workspace “${w}”?`,
      body: <>Toàn bộ đề xuất và tài liệu sẽ bị xóa vĩnh viễn — <b>không khôi phục được</b>.</>,
      confirmLabel: 'Xóa vĩnh viễn',
      onConfirm: () => { void doDeleteWorkspace(w); },
    });
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
          <span className="kicker">Bàn duyệt Commons</span>
          <p className="login-lede">Đang tải…</p>
        </div>
      </div>
    );
  }
  if (authStatus === 'out') return <Login />;

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Commons</h1>
        <h2>Không gian làm việc</h2>
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
        {error && <p className="notice notice--error" role="alert">{error}</p>}
        {!creating && <button className="ws newbtn" onClick={() => setCreating(true)}>+ Tạo workspace</button>}
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
              <option value="content-calendar">Lịch nội dung</option>
              <option value="blank">Trống</option>
            </select>
            <div className="newactions">
              <button className="btn approve" disabled={!newId.trim()} onClick={createWorkspace}>Tạo</button>
              <button className="btn" onClick={() => { setCreating(false); setCreateError(null); }}>Hủy</button>
            </div>
            {createError && <p className="notice notice--error" role="alert">{createError}</p>}
          </div>
        )}
        <div className="colophon">
          <span className="colophon-rule" />
          <p>Agent đề xuất · con người duyệt.<br />Nhánh <b>main</b> là bản đã được phê duyệt.</p>
          {me && (
            <p className="account">
              {me.email}
              <button className="ws-del" title="Đăng xuất" aria-label="Đăng xuất" onClick={logout}>⎋</button>
            </p>
          )}
        </div>
      </aside>
      <main className="main">
        {ws ? (
          <>
            <div className="tabs" role="tablist" aria-label="Khu vực workspace">
              <button role="tab" aria-selected={tab === 'assistant'} className={tab === 'assistant' ? 'tab active' : 'tab'} onClick={() => setTab('assistant')}>Trợ lý</button>
              <button role="tab" aria-selected={tab === 'proposals'} className={tab === 'proposals' ? 'tab active' : 'tab'} onClick={() => setTab('proposals')}>Đề xuất</button>
              <button role="tab" aria-selected={tab === 'files'} className={tab === 'files' ? 'tab active' : 'tab'} onClick={() => setTab('files')}>Tài liệu</button>
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
              <span className="kicker">Bàn duyệt Commons</span>
              <h2 className="frontpage-head">Bàn làm việc trống<span className="period">.</span></h2>
              <div className="dblrule"><span /><span /></div>
              <p className="frontpage-lede">
                Chọn một workspace ở cột bên trái để đọc đề xuất, xem tài liệu,
                hoặc giao việc cho trợ lý. Mọi thay đổi đều chờ bạn phê duyệt tại đây —
                không gì chạm tới <b>main</b> cho đến khi bạn merge.
              </p>
              <div className="frontpage-cues">
                <span><i className="dot indigo" /> Đề xuất đang chờ duyệt</span>
                <span><i className="dot forest" /> Bạn nắm quyền merge</span>
                <span><i className="dot amber" /> Agent không bao giờ chạm main</span>
              </div>
            </div>
          </div>
        )}
      </main>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
