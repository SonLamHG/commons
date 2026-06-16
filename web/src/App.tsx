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
