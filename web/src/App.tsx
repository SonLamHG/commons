import React, { useEffect, useState } from 'react';
import { api, UnauthorizedError, friendlyError, type Proposal, type ProposalStats } from './api';
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
  const [proposalStats, setProposalStats] = useState<Record<string, ProposalStats>>({});
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'assistant' | 'proposals' | 'files'>('assistant');
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTemplate, setNewTemplate] = useState('content-calendar');
  const [createError, setCreateError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [wsLoading, setWsLoading] = useState(false);
  const [proposalsLoading, setProposalsLoading] = useState(false);

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

  const loadWorkspaces = () => {
    setWsLoading(true);
    return api.workspaces().then(setWorkspaces)
      .catch((e) => { if (!onAuthError(e)) setError(friendlyError(e)); })
      .finally(() => setWsLoading(false));
  };
  useEffect(() => { if (authStatus === 'in') loadWorkspaces(); }, [authStatus]);

  const loadProposals = (w: string) => {
    setProposalsLoading(true);
    api.proposalStats(w).then(setProposalStats).catch(() => setProposalStats({}));
    return api.proposals(w).then(setProposals).catch(onAuthError)
      .finally(() => setProposalsLoading(false));
  };
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
      if (!onAuthError(e)) setError(friendlyError(e));
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
      setCreateError(friendlyError(e));
    }
  };

  if (authStatus === 'loading') {
    return (
      <div className="layout" aria-busy="true" aria-label="Đang tải">
        <aside className="sidebar">
          <h1>Commons</h1>
          <h2>Không gian làm việc</h2>
          <div className="ws-list">
            {[68, 52, 60].map((w, i) => (
              <div key={i} className="sk-line" style={{ width: `${w}%`, margin: '14px 2px' }} />
            ))}
          </div>
        </aside>
        <main className="main">
          <div className="frontpage">
            <div className="sk-spinner" />
          </div>
        </main>
      </div>
    );
  }
  if (authStatus === 'out') return <Login />;

  const TABS: { id: 'assistant' | 'proposals' | 'files'; label: string }[] = [
    { id: 'assistant', label: 'Trợ lý' },
    { id: 'proposals', label: 'Đề xuất' },
    { id: 'files', label: 'Tài liệu' },
  ];
  // Roving focus: ←/→ (and Home/End) move between tabs, per WAI-ARIA tabs.
  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  };

  return (
    <div className="layout">
      <a className="skip-link" href="#main-content">Tới nội dung chính</a>
      <aside className="sidebar">
        <h1>Commons</h1>
        <h2>Không gian làm việc</h2>
        <div className="ws-list">
          {wsLoading && workspaces.length === 0 &&
            [70, 55, 62, 48].map((w, i) => (
              <div key={i} className="sk-line" style={{ width: `${w}%`, margin: '14px 2px' }} />
            ))}
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
            <label className="vh" htmlFor="new-ws-id">Mã workspace</label>
            <input
              id="new-ws-id"
              className="newinput"
              placeholder="id (a-z, 0-9, -)"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              autoFocus
            />
            <label className="vh" htmlFor="new-ws-template">Mẫu khởi tạo</label>
            <select id="new-ws-template" className="newinput" value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
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
            <div className="account">
              <span className="account-email" title={me.email}>{me.email}</span>
              <button className="logout-btn" onClick={logout}>Đăng xuất</button>
            </div>
          )}
        </div>
      </aside>
      <main className="main" id="main-content">
        {ws ? (
          <>
            <div className="tabs" role="tablist" aria-label="Khu vực workspace" onKeyDown={onTabKey}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`tab-${t.id}`}
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls={`panel-${t.id}`}
                  tabIndex={tab === t.id ? 0 : -1}
                  className={tab === t.id ? 'tab active' : 'tab'}
                  onClick={() => setTab(t.id)}
                >{t.label}</button>
              ))}
            </div>
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="tabpanel">
              {tab === 'assistant'
                ? <AgentChat ws={ws} onDone={() => { setTab('proposals'); loadProposals(ws); }} />
                : tab === 'proposals'
                  ? <ProposalList ws={ws} proposals={proposals} stats={proposalStats} loading={proposalsLoading} onChanged={() => loadProposals(ws)} />
                  : <FileBrowser ws={ws} />}
            </div>
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
