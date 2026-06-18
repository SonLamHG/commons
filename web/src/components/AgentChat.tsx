import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';

type Line = { kind: 'you' | 'text' | 'tool' | 'done' | 'error'; text: string };

const TOOL_LABEL: Record<string, string> = {
  'mcp__commons__overview': 'đọc tổng quan',
  'mcp__commons__read_state': 'xem danh sách file',
  'mcp__commons__read_file': 'đọc file',
  'mcp__commons__create_proposal': 'tạo đề xuất',
  'mcp__commons__write_proposal_file': 'viết nội dung',
  'mcp__commons__diff_proposal': 'tự rà soát',
  'mcp__commons__submit_proposal': 'gửi để duyệt',
};

export function AgentChat({ ws, onDone }: { ws: string; onDone: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines, busy]);

  const send = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setLines((l) => [...l, { kind: 'you', text: p }]);
    setPrompt(''); setBusy(true);
    try {
      await api.agentStream(ws, p, (e) => {
        if (e.type === 'text' && e.text) setLines((l) => [...l, { kind: 'text', text: e.text! }]);
        else if (e.type === 'tool' && e.name) setLines((l) => [...l, { kind: 'tool', text: TOOL_LABEL[e.name!] ?? e.name! }]);
        else if (e.type === 'done') setLines((l) => [...l, { kind: 'done', text: 'Đã tạo đề xuất — mở tab Proposals để duyệt.' }]);
        else if (e.type === 'error') setLines((l) => [...l, { kind: 'error', text: e.message ?? 'lỗi' }]);
      });
      onDone();
    } catch (err) {
      setLines((l) => [...l, { kind: 'error', text: err instanceof Error ? err.message : String(err) }]);
    } finally { setBusy(false); }
  };

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
          lines.map((l, i) => {
            if (l.kind === 'you') return (
              <div key={i} className="chatmsg dispatch">
                <span className="dispatch-label">Yêu cầu</span>
                <p className="dispatch-text">{l.text}</p>
              </div>
            );
            if (l.kind === 'tool') return (
              <div key={i} className="chatmsg step">
                <span className="step-dot" />
                <span className="step-label">{l.text}</span>
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
            <button className="btn approve" disabled={busy || !prompt.trim()} onClick={send}>
              {busy ? 'Đang chạy…' : 'Gửi'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
