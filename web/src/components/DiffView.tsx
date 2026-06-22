import React, { useEffect, useState } from 'react';
import { api, type Proposal, type FileDiff, type MergeResult, isImage } from '../api';
import { renderMarkdown, resolvePostImage } from '../markdown';
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog';

const STATUS_LABEL: Record<string, string> = {
  open: 'đang mở',
  submitted: 'chờ duyệt',
  merged: 'đã merge',
  discarded: 'đã loại',
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

/* ----- Prose diff: a word-level comparison of base ↔ proposed text -----
   We tokenise into words+whitespace and run an LCS so the result reads like a
   manuscript with edits marked, not a line-oriented git table. */
type Seg = { type: 'eq' | 'ins' | 'del'; text: string };
const tokenize = (s: string): string[] => s.match(/\s+|\S+/g) ?? [];

function wordDiff(a: string, b: string): Seg[] {
  const A = tokenize(a), B = tokenize(b);
  const n = A.length, m = B.length;
  // LCS length table, filled bottom-up.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const segs: Seg[] = [];
  const push = (type: Seg['type'], text: string) => {
    const last = segs[segs.length - 1];
    if (last && last.type === type) last.text += text;
    else segs.push({ type, text });
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push('eq', A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
    else { push('ins', B[j]); j++; }
  }
  while (i < n) { push('del', A[i]); i++; }
  while (j < m) { push('ins', B[j]); j++; }
  return segs;
}

// Guard: LCS is O(n·m). Skip the prose view for very large files.
const PROSE_LIMIT = 1_400_000;

function ProseDiff({ base, next }: { base: string; next: string }) {
  if (tokenize(base).length * tokenize(next).length > PROSE_LIMIT)
    return <p className="empty">Tài liệu quá dài để so theo câu — dùng tab “Thay đổi” để xem khác biệt từng dòng.</p>;
  const segs = wordDiff(base, next);
  return (
    <div className="prose-diff">
      {segs.map((s, k) =>
        s.type === 'eq' ? <span key={k}>{s.text}</span>
          : s.type === 'ins' ? <ins key={k} className="ins">{s.text}</ins>
            : <del key={k} className="del">{s.text}</del>,
      )}
    </div>
  );
}

// A stable DOM id per file so the ToC can scroll to a section in any view.
const fileAnchor = (path: string) => 'pf_' + path.replace(/[^a-zA-Z0-9]/g, '_');

const FILE_LABEL = (s: string) => (s === 'added' ? 'Mới' : s === 'deleted' ? 'Gỡ bỏ' : 'Sửa');
const FILE_BADGE = (s: string) => (s === 'added' ? 'open' : s === 'deleted' ? 'discarded' : 'submitted');

export function DiffView({ ws, proposal, onChanged, onPrev, onNext, hasPrev, hasNext }: {
  ws: string; proposal: Proposal; onChanged: () => void;
  onPrev?: () => void; onNext?: () => void; hasPrev?: boolean; hasNext?: boolean;
}) {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);
  const [docs, setDocs] = useState<{ path: string; status: string; content: string; base: string }[] | null>(null);
  const [view, setView] = useState<'read' | 'prose'>('read');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const reviewable = proposal.status === 'submitted' || proposal.status === 'open';

  useEffect(() => {
    let live = true;
    setConflict(null); setError(null); setDiffs(null); setDocs(null); setView('read');
    // Merged/discarded proposals have no branch anymore — don't diff (avoids "unknown revision").
    if (!reviewable) { setDiffs([]); setDocs([]); return; }
    api.diff(ws, proposal.id).then(async (d) => {
      if (!live) return;
      setDiffs(d);
      // For each touched file fetch BOTH the proposed final version (for the
      // reading + prose views) and the current main version (the prose-diff base).
      const rendered = await Promise.all(
        d.map(async (f) => {
          if (isImage(f.path)) return { path: f.path, status: f.status, content: '', base: '' };
          const content = f.status === 'deleted' ? ''
            : await api.proposalFile(ws, proposal.id, f.path).then((r) => r.content).catch(() => '');
          // Added files have no base on main; deleted files have no proposed side.
          const base = f.status === 'added' ? ''
            : await api.file(ws, f.path).then((r) => r.content).catch(() => '');
          return { path: f.path, status: f.status, content, base };
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

  // Keyboard review: E merges, X rejects — but always through a confirm, since a
  // stray keypress must never merge to main (the action is irreversible). Explicit
  // button clicks are deliberate and act directly.
  useEffect(() => {
    if (!reviewable) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey || busy) return;
      if (document.querySelector('.modal-backdrop')) return; // a dialog owns the keys
      if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        setConfirm({
          title: 'Duyệt & merge vào main?',
          body: <>Đề xuất <b>“{proposal.title}”</b> sẽ được merge vào <code>main</code>. Thao tác này <b>không thể hoàn tác</b>.</>,
          confirmLabel: 'Duyệt & merge',
          onConfirm: () => { void approve(); },
        });
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        setConfirm({
          title: 'Từ chối đề xuất?',
          body: <>Đề xuất <b>“{proposal.title}”</b> sẽ bị loại bỏ. Nhánh <code>main</code> giữ nguyên.</>,
          confirmLabel: 'Từ chối',
          onConfirm: () => { void reject(); },
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reviewable, busy, proposal.title]);

  // Drop image docs whose filename is embedded by some markdown doc — otherwise
  // the picture shows twice (once as a standalone banner, once inline in the post).
  const mdText = (docs ?? []).filter((d) => d.path.endsWith('.md')).map((d) => d.content).join('\n');
  // The reading view shows the proposed FINAL document, so deleted files (gone
  // after merge) are omitted — "what's removed" lives in the prose view. Images a
  // markdown post already embeds are also dropped (no double banner).
  const readDocs = (docs ?? []).filter((d) => {
    if (d.status === 'deleted') return false;
    if (!isImage(d.path)) return true;
    const base = d.path.split('/').pop() ?? d.path;
    return !mdText.includes(base);
  });

  const hasChanges = !!(reviewable && diffs && diffs.length > 0);
  const scrollToFile = (path: string) =>
    document.getElementById(fileAnchor(path))?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const summary = (() => {
    if (!diffs) return '';
    const n = (s: string) => diffs.filter((d) => d.status === s).length;
    const parts = [n('added') && `${n('added')} mới`, n('modified') && `${n('modified')} sửa`, n('deleted') && `${n('deleted')} gỡ bỏ`].filter(Boolean);
    return `proposal/${proposal.id} → main · ${diffs.length} tệp${parts.length ? ` · ${parts.join(' · ')}` : ''}`;
  })();

  return (
    <div className="revpane">
      <div className="revbar">
        <div className="revbar-title">
          <h3>{proposal.title} <span className={`badge ${proposal.status}`}>{statusLabel(proposal.status)}</span></h3>
          {hasChanges && <p className="revbar-meta">{summary}</p>}
        </div>
        {reviewable && (
          <div className="revbar-actions">
            <button className="btn approve" disabled={busy} onClick={approve}>Duyệt &amp; merge <span className="kbd-chip">E</span></button>
            <button className="btn reject" disabled={busy} onClick={reject}>Từ chối <span className="kbd-chip">X</span></button>
          </div>
        )}
      </div>

      <div className="revbody">
        {hasChanges && (
          <nav className="revtoc" aria-label="Tệp thay đổi">
            <div className="revtoc-h">Tệp · {diffs!.length}</div>
            {diffs!.map((f, i) => (
              <button key={f.path} className="revtoc-item" onClick={() => scrollToFile(f.path)}>
                <span className="ix">{String(i + 1).padStart(2, '0')}</span>
                <span className="nm">{f.path.split('/').pop()}</span>
                <span className={`dd ${f.status}`}>{f.status === 'added' ? '+' : f.status === 'deleted' ? '−' : '±'}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="revscroll">
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

          {proposal.prompt && (
            <div className="agentctx">
              <div className="agentctx-h"><span className="ic">✦</span>Trợ lý tạo đề xuất từ yêu cầu</div>
              <blockquote>“{proposal.prompt}”</blockquote>
            </div>
          )}

          {hasChanges && (
            <div className="viewtoggle" role="group" aria-label="Chế độ xem">
              <button aria-pressed={view === 'read'} className={view === 'read' ? 'seg active' : 'seg'} onClick={() => setView('read')}>Bản đọc</button>
              <button aria-pressed={view === 'prose'} className={view === 'prose' ? 'seg active' : 'seg'} onClick={() => setView('prose')}>Văn xuôi</button>
            </div>
          )}

          {/* Prose view: word-level diff of base ↔ proposed, reads like a marked-up
              manuscript. The default — gentlest for non-technical reviewers. */}
          {view === 'prose' && docs && diffs?.map((f) => {
            const doc = docs.find((d) => d.path === f.path);
            return (
              <div key={f.path} id={fileAnchor(f.path)} className="docwrap">
                <div className="docmeta">
                  <span className={`badge ${FILE_BADGE(f.status)}`}>{FILE_LABEL(f.status)}</span>
                  <span className="docpath">{f.path}</span>
                </div>
                {isImage(f.path)
                  ? (f.status === 'deleted'
                      ? <p className="empty">Ảnh này sẽ bị gỡ bỏ.</p>
                      : <img className="post-image" src={api.proposalAssetUrl(ws, proposal.id, f.path)} alt={f.path} />)
                  : f.status === 'deleted'
                    ? <ProseDiff base={doc?.base ?? ''} next="" />
                    : f.status === 'added'
                      ? (f.path.endsWith('.md')
                          ? <div className="doc doc--new" dangerouslySetInnerHTML={{ __html: renderMarkdown(doc?.content ?? '', resolvePostImage(f.path, (p) => api.proposalAssetUrl(ws, proposal.id, p))) }} />
                          : <pre className="diff-body diff-body--pad doc--new">{doc?.content}</pre>)
                      : <ProseDiff base={doc?.base ?? ''} next={doc?.content ?? ''} />}
              </div>
            );
          })}

          {/* Reading view: the proposed final document, as clean as possible —
              just the manuscript under a light path caption. Embedded images are
              hidden to avoid showing the same picture twice (banner + inline). */}
          {view === 'read' && hasChanges && readDocs.length === 0 && (
            <p className="empty">Đề xuất này chỉ gỡ bỏ tài liệu — xem chi tiết ở tab Văn xuôi.</p>
          )}
          {view === 'read' && readDocs?.map((d) => (
            <article key={d.path} id={fileAnchor(d.path)} className="readdoc">
              <div className="readdoc-cap">{d.path}</div>
              {isImage(d.path)
                ? <img className="post-image" src={api.proposalAssetUrl(ws, proposal.id, d.path)} alt={d.path} />
                : d.path.endsWith('.md')
                  ? <div className="doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(d.content, resolvePostImage(d.path, (p) => api.proposalAssetUrl(ws, proposal.id, p))) }} />
                  : <pre className="diff-body diff-body--pad">{d.content}</pre>}
            </article>
          ))}
        </div>
      </div>

      {(onPrev || onNext) && (
        <div className="revfoot">
          <span className="revfoot-note"><i className="seal" /> Chỉ bạn mới merge được — agent không thể chạm <b>main</b>.</span>
          <div className="revfoot-nav">
            <button className="btn ghost" disabled={!hasPrev} onClick={onPrev}>‹ Trước <span className="kbd-chip">K</span></button>
            <button className="btn ghost" disabled={!hasNext} onClick={onNext}>Kế tiếp <span className="kbd-chip">J</span> ›</button>
          </div>
        </div>
      )}

      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
