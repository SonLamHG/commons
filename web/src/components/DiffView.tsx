import React, { useEffect, useState } from 'react';
import { api, type Proposal, type FileDiff, type MergeResult, isImage } from '../api';
import { renderMarkdown, resolvePostImage } from '../markdown';

const STATUS_LABEL: Record<string, string> = {
  open: 'đang mở',
  submitted: 'chờ duyệt',
  merged: 'đã merge',
  discarded: 'đã loại',
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

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
  const [docs, setDocs] = useState<{ path: string; status: string; content: string }[] | null>(null);
  const [view, setView] = useState<'read' | 'changes'>('read');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reviewable = proposal.status === 'submitted' || proposal.status === 'open';

  useEffect(() => {
    let live = true;
    setConflict(null); setError(null); setDiffs(null); setDocs(null); setView('read');
    // Merged/discarded proposals have no branch anymore — don't diff (avoids "unknown revision").
    if (!reviewable) { setDiffs([]); setDocs([]); return; }
    api.diff(ws, proposal.id).then(async (d) => {
      if (!live) return;
      setDiffs(d);
      // For the reading view, fetch the proposed final version of each touched file.
      const rendered = await Promise.all(
        d.map(async (f) => {
          if (f.status === 'deleted') return { path: f.path, status: f.status, content: '' };
          if (isImage(f.path)) return { path: f.path, status: f.status, content: '' };
          try { const r = await api.proposalFile(ws, proposal.id, f.path); return { path: f.path, status: f.status, content: r.content }; }
          catch { return { path: f.path, status: f.status, content: '' }; }
        }),
      );
      if (live) setDocs(rendered);
    }).catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
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

  // Drop image docs whose filename is embedded by some markdown doc — otherwise
  // the picture shows twice (once as a standalone banner, once inline in the post).
  const mdText = (docs ?? []).filter((d) => d.path.endsWith('.md')).map((d) => d.content).join('\n');
  const readDocs = (docs ?? []).filter((d) => {
    if (!isImage(d.path)) return true;
    const base = d.path.split('/').pop() ?? d.path;
    return !mdText.includes(base);
  });

  return (
    <div>
      <div className="reviewbar">
        <h3>{proposal.title} <span className={`badge ${proposal.status}`}>{statusLabel(proposal.status)}</span></h3>
        {reviewable && (
          <div className="actions reviewbar-actions">
            <button className="btn approve" disabled={busy} onClick={approve}>Duyệt &amp; merge</button>
            <button className="btn reject" disabled={busy} onClick={reject}>Từ chối</button>
          </div>
        )}
      </div>
      {!reviewable && (
        <p className="empty">Đề xuất này {statusLabel(proposal.status)} — đã xử lý xong, không còn gì để duyệt.</p>
      )}
      {conflict && (
        <div className="conflict">
          Xung đột merge ở: {conflict.join(', ')}. Nhánh main được giữ nguyên. Hãy giải quyết và gửi lại.
        </div>
      )}
      {error && <div className="conflict">Thao tác thất bại: {error}</div>}
      {reviewable && diffs === null && <p className="empty">Đang tải…</p>}
      {reviewable && diffs?.length === 0 && <p className="empty">Không có thay đổi.</p>}

      {reviewable && diffs && diffs.length > 0 && (
        <div className="viewtoggle" role="group" aria-label="Chế độ xem">
          <button aria-pressed={view === 'read'} className={view === 'read' ? 'seg active' : 'seg'} onClick={() => setView('read')}>Bản đọc</button>
          <button aria-pressed={view === 'changes'} className={view === 'changes' ? 'seg active' : 'seg'} onClick={() => setView('changes')}>Thay đổi</button>
        </div>
      )}

      {/* Reading view: the proposed final document, as a marketer would read it.
          Standalone image assets that a markdown post already embeds are hidden
          here so the same picture doesn't appear twice (banner + inline). */}
      {view === 'read' && readDocs?.map((d) => (
        <div key={d.path} className="docwrap">
          <div className="docmeta">
            <span className={`badge ${d.status === 'added' ? 'open' : d.status === 'deleted' ? 'discarded' : 'submitted'}`}>
              {d.status === 'added' ? 'Mới' : d.status === 'deleted' ? 'Gỡ bỏ' : 'Sửa'}
            </span>
            <span className="docpath">{d.path}</span>
          </div>
          {d.status === 'deleted'
            ? <p className="empty">Tài liệu này sẽ bị gỡ bỏ.</p>
            : isImage(d.path)
              ? <img className="post-image" src={api.proposalAssetUrl(ws, proposal.id, d.path)} alt={d.path} />
              : d.path.endsWith('.md')
                ? <div className="doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(d.content, resolvePostImage(d.path, (p) => api.proposalAssetUrl(ws, proposal.id, p))) }} />
                : <pre className="diff-body diff-body--pad">{d.content}</pre>}
        </div>
      ))}

      {/* Changes view: the precise git-level diff, for those who want it. */}
      {view === 'changes' && diffs?.map((d) => (
        <div key={d.path} className="diff-file">
          <h4>[{d.status}] {d.path}</h4>
          <DiffBody diff={d.diff} />
        </div>
      ))}
    </div>
  );
}
