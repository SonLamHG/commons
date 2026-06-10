import React, { useState } from 'react';
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
      <div className="chatlog">
        {lines.length === 0 && <p className="empty">Mô tả việc bạn muốn — ví dụ: "Viết 3 post LinkedIn từ brief tháng 6". Trợ lý sẽ soạn một đề xuất để bạn duyệt.</p>}
        {lines.map((l, i) => (
          <div key={i} className={`chatline ${l.kind}`}>
            {l.kind === 'tool' ? <span className="chiptool">⚙ {l.text}</span> : l.text}
          </div>
        ))}
        {busy && <div className="chatline tool"><span className="chiptool">…đang làm việc</span></div>}
      </div>
      <div className="chatbox">
        <textarea
          value={prompt} disabled={busy}
          placeholder="Bạn muốn trợ lý làm gì?"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
        />
        <button className="btn approve" disabled={busy || !prompt.trim()} onClick={send}>
          {busy ? 'Đang chạy…' : 'Gửi (⌘/Ctrl+Enter)'}
        </button>
      </div>
    </div>
  );
}
