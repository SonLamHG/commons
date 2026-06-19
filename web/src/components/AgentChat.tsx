import React, { useEffect, useRef, useState } from 'react';
import { api, friendlyError } from '../api';

type Line = { kind: 'you' | 'text' | 'tool' | 'done' | 'error' | 'cancelled'; text: string };

const TOOL_LABEL: Record<string, string> = {
  'mcp__commons__overview': 'đọc tổng quan',
  'mcp__commons__read_state': 'xem danh sách file',
  'mcp__commons__read_file': 'đọc file',
  'mcp__commons__create_proposal': 'tạo đề xuất',
  'mcp__commons__write_proposal_file': 'viết nội dung',
  'mcp__commons__diff_proposal': 'tự rà soát',
  'mcp__commons__submit_proposal': 'gửi để duyệt',
};

const HISTORY_CAP = 200;
const historyKey = (ws: string) => `commons.chat.${ws}`;

function loadHistory(ws: string): Line[] {
  try {
    const raw = localStorage.getItem(historyKey(ws));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveHistory(ws: string, lines: Line[]) {
  try {
    localStorage.setItem(historyKey(ws), JSON.stringify(lines.slice(-HISTORY_CAP)));
  } catch { /* storage blocked or full — degrade to in-memory */ }
}

export function AgentChat({ ws, onDone }: { ws: string; onDone: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [lines, setLines] = useState<Line[]>(() => loadHistory(ws));
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reload persisted history when the active workspace changes.
  useEffect(() => { setLines(loadHistory(ws)); }, [ws]);

  // Persist on every change (covers tab switches via unmount and reloads).
  useEffect(() => { saveHistory(ws, lines); }, [ws, lines]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines, busy]);

  // Abort any in-flight run if the component unmounts (e.g. tab switch).
  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setLines((l) => [...l, { kind: 'you', text: p }]);
    setPrompt(''); setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await api.agentStream(ws, p, (e) => {
        if (e.type === 'text' && e.text) setLines((l) => [...l, { kind: 'text', text: e.text! }]);
        else if (e.type === 'tool' && e.name) setLines((l) => [...l, { kind: 'tool', text: TOOL_LABEL[e.name!] ?? e.name! }]);
        else if (e.type === 'done') setLines((l) => [...l, { kind: 'done', text: 'Đã tạo đề xuất — mở tab Proposals để duyệt.' }]);
        else if (e.type === 'error') setLines((l) => [...l, { kind: 'error', text: e.message ?? 'lỗi' }]);
      }, ctrl.signal);
      onDone();
    } catch (err) {
      // A user-initiated cancel is not an error — show a neutral line instead.
      if (ctrl.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        setLines((l) => [...l, { kind: 'cancelled', text: 'Đã dừng theo yêu cầu.' }]);
      } else {
        setLines((l) => [...l, { kind: 'error', text: friendlyError(err) }]);
      }
    } finally { setBusy(false); abortRef.current = null; }
  };

  const cancel = () => abortRef.current?.abort();

  // Fold runs of consecutive tool steps into one block for a tidy log.
  const blocks: ({ kind: 'steps'; items: string[] } | { line: Line })[] = [];
  for (const l of lines) {
    if (l.kind === 'tool') {
      const last = blocks[blocks.length - 1];
      if (last && 'kind' in last && last.kind === 'steps') last.items.push(l.text);
      else blocks.push({ kind: 'steps', items: [l.text] });
    } else {
      blocks.push({ line: l });
    }
  }

  return (
    <div className="chat">
      <div className="chatlog" ref={logRef} role="log" aria-live="polite" aria-busy={busy}>
        {lines.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-ornament">✦ ✦ ✦</div>
            <p className="chat-empty-lead">Mô tả việc bạn muốn làm</p>
            <p className="chat-empty-example">"Viết 3 post LinkedIn từ brief tháng 6"</p>
            <p className="chat-empty-sub">Trợ lý sẽ đọc workspace, soạn nội dung,<br/>và gửi đề xuất để bạn duyệt.</p>
          </div>
        ) : (
          blocks.map((b, i) => {
            if ('kind' in b) return (
              <div key={i} className="chatmsg steps">
                {b.items.map((t, j) => (
                  <div key={j} className="step-row">
                    <span className="step-dot" />
                    <span className="step-label">{t}</span>
                  </div>
                ))}
              </div>
            );
            const l = b.line;
            if (l.kind === 'you') return (
              <div key={i} className="chatmsg dispatch">
                <span className="dispatch-label">Yêu cầu</span>
                <p className="dispatch-text">{l.text}</p>
              </div>
            );
            if (l.kind === 'text') return (
              <div key={i} className="chatmsg reply">
                <p>{l.text}</p>
              </div>
            );
            if (l.kind === 'done') return (
              <div key={i} className="chatmsg done-msg">
                <span className="done-stamp">Gửi xong</span>
                <p>{l.text}</p>
              </div>
            );
            if (l.kind === 'cancelled') return (
              <div key={i} className="chatmsg cancelled-msg">
                <span className="step-dot" />
                <p>{l.text}</p>
              </div>
            );
            return (
              <div key={i} className="chatmsg error-msg">
                <p>{l.text}</p>
              </div>
            );
          })
        )}
        {busy && (
          <div className="chatmsg step step--busy">
            <span className="step-dot" />
            <span className="step-label">đang làm việc…</span>
          </div>
        )}
      </div>

      <div className="chatbox">
        <div className="chatbox-card">
          <label className="chatbox-eyebrow">Yêu cầu mới</label>
          <textarea
            value={prompt}
            disabled={busy}
            placeholder="Bạn muốn trợ lý làm gì?"
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          />
          <div className="chatbox-bar">
            <span className="chatbox-hint">⌘ / Ctrl+Enter để gửi</span>
            {busy
              ? <button className="btn reject" onClick={cancel}>Dừng</button>
              : <button className="btn approve" disabled={!prompt.trim()} onClick={send}>Gửi</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
