import React, { useEffect, useMemo, useRef, useState } from 'react';
import { type Proposal } from '../api';
import { DiffView } from './DiffView';

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

// Calm status marker per status — a dot + small-caps label, no rubber stamp in
// the dense queue (the stamp is reserved as a signature gesture in the review pane).
const MARK: Record<string, { label: string; tone: string }> = {
  submitted: { label: 'Chờ duyệt', tone: 'gold' },
  open: { label: 'Đang mở', tone: 'slatec' },
  merged: { label: 'Đã merge', tone: 'pine' },
  discarded: { label: 'Từ chối', tone: 'stone' },
};
const mark = (s: string) => MARK[s] ?? { label: s, tone: 'stone' };

const needsReview = (s: string) => s === 'submitted' || s === 'open';

export function ProposalList({ ws, proposals, loading = false, onChanged }: {
  ws: string; proposals: Proposal[]; loading?: boolean; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const byNewest = useMemo(
    () => [...proposals].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [proposals],
  );
  // Two action-oriented groups: what needs you, then what's done.
  const needs = useMemo(() => byNewest.filter((p) => needsReview(p.status)), [byNewest]);
  const done = useMemo(() => byNewest.filter((p) => !needsReview(p.status)), [byNewest]);
  // Flat visual order drives keyboard navigation and prev/next.
  const order = useMemo(() => [...needs, ...done], [needs, done]);

  // Auto-select the first item that needs review (falls back to the first overall)
  // so the desk is never empty when there's work to do.
  useEffect(() => {
    if (selected && order.some((p) => p.id === selected)) return;
    setSelected(order[0]?.id ?? null);
  }, [order, selected]);

  const idx = order.findIndex((p) => p.id === selected);
  const selectedProposal = idx >= 0 ? order[idx] : null;
  const go = (delta: number) => {
    const next = order[idx + delta];
    if (next) setSelected(next.id);
  };

  // Keyboard: j/k (or ↑/↓) move through the queue. Non-destructive — review and
  // merge stay deliberate button actions (merge is irreversible).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('.modal-backdrop')) return; // a dialog owns the keys
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); go(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, order]);

  // Keep the selected row in view as selection moves by keyboard.
  useEffect(() => {
    scrollRef.current?.querySelector<HTMLElement>('.qrow.on')?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const total = proposals.length;
  const remaining = needs.length;
  const reviewedPct = total ? Math.round(((total - remaining) / total) * 100) : 0;

  const renderRow = (p: Proposal) => {
    const mk = mark(p.status);
    return (
      <button
        key={p.id}
        className={`qrow${p.id === selected ? ' on' : ''}`}
        onClick={() => setSelected(p.id)}
      >
        <span className="qrow-top">
          <span className={`qmark ${mk.tone}`}><i className="qdot" />{mk.label}</span>
          <span className="qid">{p.id.slice(0, 4)}</span>
        </span>
        <span className="qttl">{p.title}</span>
        <span className="qmeta"><span className="qwhen">{relativeTime(p.createdAt)}</span></span>
      </button>
    );
  };

  return (
    <div className="reviewdesk">
      <aside className="queue">
        <div className="queue-top">
          <div className="queue-head">
            <h2>Hàng đợi duyệt</h2>
            <span className="queue-count"><b>{remaining}</b>&thinsp;/&thinsp;{total}</span>
          </div>
          <div className="meter" aria-hidden="true"><i style={{ width: `${reviewedPct}%` }} /></div>
          <p className="queue-sub">
            {remaining > 0
              ? <>Còn <b>{remaining} đề xuất</b> chờ bạn duyệt</>
              : 'Đã duyệt hết — bàn làm việc trống.'}
          </p>
        </div>

        <div className="queue-scroll" ref={scrollRef}>
          {loading && proposals.length === 0 && (
            <div className="sk-props" aria-busy="true" aria-label="Đang tải đề xuất">
              {[0, 1, 2].map((i) => (
                <div key={i} className="sk-prop">
                  <div className="sk-line" style={{ width: '34%', height: 14 }} />
                  <div className="sk-line" style={{ width: '72%' }} />
                </div>
              ))}
            </div>
          )}
          {!loading && proposals.length === 0 && <p className="empty">Chưa có đề xuất nào.</p>}

          {needs.length > 0 && (
            <section className="qgroup">
              <h3 className="qgroup-head">Cần bạn duyệt <span className="n">{needs.length}</span></h3>
              {needs.map(renderRow)}
            </section>
          )}
          {done.length > 0 && (
            <section className="qgroup">
              <h3 className="qgroup-head">Đã xử lý <span className="n">{done.length}</span></h3>
              {done.map(renderRow)}
            </section>
          )}
        </div>
      </aside>

      <div className="reviewhost">
        {selectedProposal
          ? (
            <DiffView
              key={selectedProposal.id}
              ws={ws}
              proposal={selectedProposal}
              // After a merge/reject, advance to the next item so the reviewer
              // flows down the queue (“inbox zero”) instead of landing on the
              // now-resolved proposal. Then reload from the server.
              onChanged={() => { go(1); onChanged(); }}
              onPrev={() => go(-1)}
              onNext={() => go(1)}
              hasPrev={idx > 0}
              hasNext={idx < order.length - 1}
            />
          )
          : !loading && <p className="empty empty--center">Chọn một đề xuất ở hàng đợi để duyệt.</p>}
      </div>
    </div>
  );
}
