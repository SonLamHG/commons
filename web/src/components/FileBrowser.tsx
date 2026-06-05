import React, { useEffect, useState } from 'react';
import { api, type FileNode } from '../api';

export function FileBrowser({ ws }: { ws: string }) {
  const [files, setFiles] = useState<FileNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelected(null); setContent(null); setError(null); setFiles(null);
    api.state(ws).then((nodes) => setFiles(nodes.filter((n) => n.type === 'file')))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ws]);

  useEffect(() => {
    if (!selected) { setContent(null); return; }
    let live = true;
    setContent(null);
    api.file(ws, selected).then((r) => { if (live) setContent(r.content); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [ws, selected]);

  return (
    <div className="proposals">
      <div className="list">
        <h2>Files</h2>
        {error && <p className="empty" style={{ color: '#cb2431' }}>{error}</p>}
        {files === null && <p className="empty">Loading…</p>}
        {files?.length === 0 && <p className="empty">No files yet.</p>}
        {files?.map((f) => (
          <button key={f.path} className={f.path === selected ? 'prop active' : 'prop'} onClick={() => setSelected(f.path)}>
            <span className="title" style={{ fontFamily: 'monospace', fontWeight: 400 }}>{f.path}</span>
          </button>
        ))}
      </div>
      <div className="detail">
        {!selected && <p className="empty">Select a file to view.</p>}
        {selected && content === null && <p className="empty">Loading…</p>}
        {selected && content !== null && (
          <div className="diff-file">
            <h4>{selected}</h4>
            <pre className="diff-body" style={{ padding: '12px' }}>{content}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
