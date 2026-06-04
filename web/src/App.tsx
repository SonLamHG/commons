import React, { useEffect, useState } from 'react';
import { api, type Proposal } from './api';
import { ProposalList } from './components/ProposalList';

export function App() {
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [ws, setWs] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.workspaces().then(setWorkspaces).catch((e) => setError(e instanceof Error ? e.message : String(e))); }, []);
  const loadProposals = (w: string) => api.proposals(w).then(setProposals);
  useEffect(() => { if (ws) loadProposals(ws); }, [ws]);

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
        {ws
          ? <ProposalList ws={ws} proposals={proposals} onChanged={() => loadProposals(ws)} />
          : <p className="empty">Select a workspace.</p>}
      </main>
    </div>
  );
}
