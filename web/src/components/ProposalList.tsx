import React, { useState } from 'react';
import { type Proposal } from '../api';
import { DiffView, statusLabel } from './DiffView';

/** Compact relative time, e.g. "2 giờ trước". Falls back to a date for old items. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const s = Math.round((Date.now() - then) / 1000);
  if (s < 60) return 'vừa xong';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} giờ trước`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} ngày trước`;
  return new Date(iso).toLocaleDateString();
}

// Review-priority groups: pending work first, resolved last.
const GROUPS: { key: string; label: string; has: (s: string) => boolean }[] = [
  { key: 'submitted', label: 'Chờ duyệt', has: (s) => s === 'submitted' },
  { key: 'open', label: 'Đang mở', has: (s) => s === 'open' },
  { key: 'resolved', label: 'Đã xử lý', has: (s) => s === 'merged' || s === 'discarded' },
];

export function ProposalList({ ws, proposals, loading = false, onChanged }: {
  ws: string; proposals: Proposal[]; loading?: boolean; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const selectedProposal = proposals.find((p) => p.id === selected) ?? null;

  const byNewest = [...proposals].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <div className="proposals">
      <div className="list">
        <h2>Đề xuất</h2>
        {loading && proposals.length === 0 && (
          <div className="sk-props" aria-busy="true" aria-label="Đang tải đề xuất">
            {[0, 1, 2].map((i) => (
              <div key={i} className="sk-prop">
                <div className="sk-line" style={{ width: '38%', height: 16 }} />
                <div className="sk-line" style={{ width: '72%' }} />
                <div className="sk-line" style={{ width: '30%' }} />
              </div>
            ))}
          </div>
        )}
        {!loading && proposals.length === 0 && <p className="empty">Chưa có đề xuất nào.</p>}
        {GROUPS.map((g) => {
          const items = byNewest.filter((p) => g.has(p.status));
          if (items.length === 0) return null;
          return (
            <section key={g.key} className="prop-group">
              <h3 className="prop-group__head" data-group={g.key}>{g.label}<span className="prop-group__count">{items.length}</span></h3>
              {items.map((p) => (
                <button key={p.id} className={p.id === selected ? 'prop active' : 'prop'} onClick={() => setSelected(p.id)}>
                  <span className={`badge ${p.status}`}>{statusLabel(p.status)}</span>
                  <span className="prop-main">
                    <span className="title">{p.title}</span>
                    <span className="prop-time">{relativeTime(p.createdAt)}</span>
                  </span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
      <div className="detail">
        {selectedProposal
          ? <DiffView ws={ws} proposal={selectedProposal} onChanged={() => { setSelected(null); onChanged(); }} />
          : <p className="empty">Chọn một đề xuất để duyệt.</p>}
      </div>
    </div>
  );
}
