import React, { useEffect, useState } from 'react';
import { api, type Proposal } from './api';
import { ProposalList } from './components/ProposalList';
import { FileBrowser } from './components/FileBrowser';
import { AgentChat } from './components/AgentChat';

export function App() {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [ws, setWs] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'assistant' | 'proposals' | 'files'>('assistant');
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTemplate, setNewTemplate] = useState('content-calendar');
  const [createError, setCreateError] = useState<string | null>(null);

  const loadWorkspaces = () => api.workspaces().then(setWorkspaces).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => { loadWorkspaces(); }, []);

  const loadProposals = (w: string) => api.proposals(w).then(setProposals);
  useEffect(() => { if (ws) { setTab('assistant'); loadProposals(ws); } }, [ws]);

  const createWorkspace = async () => {
    setCreateError(null);
    try {
      await api.createWorkspace(newId.trim(), newTemplate);
      await loadWorkspaces();
      setWs(newId.trim());
      setTab('assistant');
      setCreating(false); setNewId('');
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      let msg = raw;
      try { msg = JSON.parse(raw).error ?? raw; } catch { /* keep raw */ }
      setCreateError(msg);
    }
  };

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Commons</h1>
        <h2>Workspaces</h2>
        {workspaces.map((w) => (
          <button key={w} className={w === ws ? 'ws active' : 'ws'} onClick={() => setWs(w)}>{w}</button>
        ))}
        {error && <p className="empty" style={{ color: '#ffb4b4' }}>{error}</p>}
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
            {createError && <p className="empty" style={{ color: '#ffb4b4' }}>{createError}</p>}
          </div>
        )}
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
        ) : <p className="empty">Select a workspace.</p>}
      </main>
    </div>
  );
}
