import React, { useEffect, useState } from 'react';
import { api, type Proposal } from './api';
import { ProposalList } from './components/ProposalList';
import { FileBrowser } from './components/FileBrowser';

export function App() {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [ws, setWs] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'proposals' | 'files'>('proposals');

  useEffect(() => { api.workspaces().then(setWorkspaces).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);
  const loadProposals = (w: string) => api.proposals(w).then(setProposals);
  useEffect(() => { if (ws) { setTab('proposals'); loadProposals(ws); } }, [ws]);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Commons</h1>
        <h2>Workspaces</h2>
        {workspaces.map((w) => (
          <button key={w} className={w === ws ? 'ws active' : 'ws'} onClick={() => setWs(w)}>{w}</button>
        ))}
        {error && <p className="empty" style={{ color: '#ffb4b4' }}>{error}</p>}
      </aside>
      <main className="main">
        {ws ? (
          <>
            <div className="tabs">
              <button className={tab === 'proposals' ? 'tab active' : 'tab'} onClick={() => setTab('proposals')}>Proposals</button>
              <button className={tab === 'files' ? 'tab active' : 'tab'} onClick={() => setTab('files')}>Files</button>
            </div>
            {tab === 'proposals'
              ? <ProposalList ws={ws} proposals={proposals} onChanged={() => loadProposals(ws)} />
              : <FileBrowser ws={ws} />}
          </>
        ) : <p className="empty">Select a workspace.</p>}
      </main>
    </div>
  );
}
