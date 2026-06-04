import React, { useEffect, useState } from 'react';
import { api, type Proposal, type FileDiff, type MergeResult } from '../api';

function DiffBody({ diff }: { diff: string }) {
  return (
    <pre className="diff-body">
      {diff.split('\n').map((line, i) => {
        const cls = line.startsWith('+') && !line.startsWith('+++') ? 'add'
          : line.startsWith('-') && !line.startsWith('---') ? 'del'
          : (line.startsWith('diff ') || line.startsWith('@@') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) ? 'meta'
          : '';
        return <div key={i} className={`diff-line ${cls}`}>{line || ' '}</div>;
      })}
    </pre>
  );
}

export function DiffView({ ws, proposal, onChanged }: { ws: string; proposal: Proposal; onChanged: () => void; }) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviewable = proposal.status === 'submitted' || proposal.status === 'open';

  useEffect(() => {
    let live = true;
    setConflict(null); setError(null); setDiffs(null);
    // Merged/discarded proposals have no branch anymore — don't diff (avoids "unknown revision").
    if (!reviewable) { setDiffs([]); return; }
    api.diff(ws, proposal.id).then((d) => { if (live) setDiffs(d); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [ws, proposal.id, reviewable]);

  const approve = async () => {
    setBusy(true); setError(null);
    try {
      const res: MergeResult = await api.approve(ws, proposal.id);
      if (res.merged) onChanged();
      else setConflict(res.conflicts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const reject = async () => {
    setBusy(true); setError(null);
    try { await api.reject(ws, proposal.id); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <h3>{proposal.title} <span className={`badge ${proposal.status}`}>{proposal.status}</span></h3>
      {!reviewable && (
        <p className="empty">This proposal is {proposal.status} — already resolved, nothing to review.</p>
      )}
      {conflict && (
        <div className="conflict">
          Merge conflict on: {conflict.join(', ')}. Main was left untouched. Resolve and resubmit.
        </div>
      )}
      {error && <div className="conflict">Action failed: {error}</div>}
      {reviewable && (
        <div className="actions">
          <button className="btn approve" disabled={busy} onClick={approve}>Approve &amp; merge</button>
          <button className="btn reject" disabled={busy} onClick={reject}>Reject</button>
        </div>
      )}
      {reviewable && diffs === null && <p className="empty">Loading diff…</p>}
      {reviewable && diffs?.length === 0 && <p className="empty">No changes.</p>}
      {diffs?.map((d) => (
        <div key={d.path} className="diff-file">
          <h4>[{d.status}] {d.path}</h4>
          <DiffBody diff={d.diff} />
        </div>
      ))}
    </div>
  );
}
