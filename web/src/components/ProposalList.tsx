import React, { useState } from 'react';
import { type Proposal } from '../api';
import { DiffView } from './DiffView';

export function ProposalList({ ws, proposals, onChanged }: {
  ws: string; proposals: Proposal[]; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedProposal = proposals.find((p) => p.id === selected) ?? null;
  return (
    <div className="proposals">
      <div className="list">
        <h2>Proposals</h2>
        {proposals.length === 0 && <p className="empty">No proposals.</p>}
        {proposals.map((p) => (
          <button key={p.id} className={p.id === selected ? 'prop active' : 'prop'} onClick={() => setSelected(p.id)}>
            <span className={`badge ${p.status}`}>{p.status}</span>
            <span className="title">{p.title}</span>
          </button>
        ))}
      </div>
      <div className="detail">
        {selectedProposal
          ? <DiffView ws={ws} proposal={selectedProposal} onChanged={() => { setSelected(null); onChanged(); }} />
          : <p className="empty">Select a proposal to review.</p>}
      </div>
    </div>
  );
}
