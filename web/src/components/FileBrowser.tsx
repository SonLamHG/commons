import React, { useEffect, useRef, useState } from 'react';
import { api, type FileNode } from '../api';
import { renderMarkdown } from '../markdown';

export function FileBrowser({ ws }: { ws: string }) {
  const [files, setFiles] = useState<FileNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [webhook, setWebhook] = useState('');
  const [savedWebhook, setSavedWebhook] = useState<string | undefined>(undefined);
  const [published, setPublished] = useState<Record<string, { publishedAt: string }>>({});
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadFiles = () => api.state(ws).then((nodes) => setFiles(nodes.filter((n) => n.type === 'file')))
    .catch((e) => setError(e instanceof Error ? e.message : String(e)));

  useEffect(() => {
    setSelected(null); setContent(null); setError(null); setFiles(null); setPublishMsg(null); setUploadMsg(null);
    loadFiles();
    api.getConfig(ws).then((c) => { setSavedWebhook(c.webhookUrl); setWebhook(c.webhookUrl ?? ''); }).catch(() => {});
    api.published(ws).then(setPublished).catch(() => {});
  }, [ws]);

  useEffect(() => {
    setPublishMsg(null);
    if (!selected) { setContent(null); return; }
    let live = true;
    setContent(null);
    api.file(ws, selected).then((r) => { if (live) setContent(r.content); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [ws, selected]);

  const saveWebhook = async () => {
    try {
      await api.setConfig(ws, webhook.trim());
      setSavedWebhook(webhook.trim() || undefined);
      setPublishMsg('Webhook saved.');
    } catch (e) { setPublishMsg(e instanceof Error ? e.message : String(e)); }
  };

  const doPublish = async () => {
    if (!selected) return;
    setPublishing(true); setPublishMsg(null);
    try {
      await api.publish(ws, selected);
      api.published(ws).then(setPublished).catch(() => {});
      setPublishMsg('Published ✓');
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      let msg = raw; try { msg = JSON.parse(raw).error ?? raw; } catch { /* keep raw */ }
      setPublishMsg('Publish failed: ' + msg);
    } finally { setPublishing(false); }
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-uploading the same file
    if (!file) return;
    setUploading(true); setUploadMsg(null);
    try {
      const { path } = await api.uploadFile(ws, file);
      await loadFiles();
      setUploadMsg(`Đã thêm ${path} — agent có thể đọc làm ngữ cảnh.`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let msg = raw; try { msg = JSON.parse(raw).error ?? raw; } catch { /* keep raw */ }
      setUploadMsg('Upload lỗi: ' + msg);
    } finally { setUploading(false); }
  };

  const onDelete = async () => {
    if (!selected) return;
    if (!window.confirm(`Xóa "${selected}"? Hành động này không hoàn tác được.`)) return;
    try {
      await api.deleteFile(ws, selected);
      setSelected(null); setContent(null);
      await loadFiles();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let msg = raw; try { msg = JSON.parse(raw).error ?? raw; } catch { /* keep raw */ }
      setError('Xóa lỗi: ' + msg);
    }
  };

  const isMd = !!selected && selected.endsWith('.md');
  const pub = selected ? published[selected] : undefined;

  return (
    <div>
      <div className="webhookbar">
        <label>Publish webhook</label>
        <input className="newinput" placeholder="https://hook.make.com/... or a Discord webhook URL"
          value={webhook} onChange={(e) => setWebhook(e.target.value)} />
        <button className="btn save" onClick={saveWebhook}>Save</button>
      </div>
      <div className="uploadbar">
        <div>
          <strong>Tư liệu nguồn</strong>
          <span className="empty"> — brief, brand-voice, ghi chú (.md, .txt, .pdf, .docx)</span>
        </div>
        <input ref={fileInput} type="file" accept=".md,.markdown,.txt,.pdf,.docx" style={{ display: 'none' }} onChange={onUpload} />
        <button className="btn save" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? 'Đang tải…' : '↑ Upload tài liệu'}
        </button>
      </div>
      {uploadMsg && <p className="empty" style={{ padding: '0 28px', color: uploadMsg.includes('lỗi') ? '#c43d23' : '#2f6b46' }}>{uploadMsg}</p>}
      <div className="proposals">
        <div className="list">
          <h2>Files</h2>
          {error && <p className="empty" style={{ color: '#c43d23' }}>{error}</p>}
          {files === null && <p className="empty">Loading…</p>}
          {files?.length === 0 && <p className="empty">No files yet.</p>}
          {files?.map((f) => (
            <button key={f.path} className={f.path === selected ? 'prop active' : 'prop'} onClick={() => setSelected(f.path)}>
              <span className="title" style={{ fontFamily: 'monospace', fontWeight: 400 }}>{f.path}</span>
              {published[f.path] && <span className="badge merged">published</span>}
            </button>
          ))}
        </div>
        <div className="detail">
          {!selected && <p className="empty">Select a file to view.</p>}
          {selected && (
            <>
              <div className="detailbar">
                <span className="docpath">{selected}</span>
                <button className="btn reject ghost" onClick={onDelete}>Xóa file</button>
              </div>
              {isMd && (
                <div className="actions">
                  <button className="btn approve" disabled={publishing || !savedWebhook} onClick={doPublish}>
                    {pub ? 'Re-publish' : 'Publish'}
                  </button>
                  {!savedWebhook && <span className="empty">Set a webhook above to publish.</span>}
                  {pub && <span className="empty">Last published {new Date(pub.publishedAt).toLocaleString()}</span>}
                </div>
              )}
              {publishMsg && <p className="empty" style={{ color: publishMsg.includes('failed') ? '#c43d23' : '#2f6b46' }}>{publishMsg}</p>}
              {content === null && <p className="empty">Loading…</p>}
              {content !== null && (
                isMd
                  ? <div className="doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
                  : (
                    <div className="diff-file">
                      <h4>{selected}</h4>
                      <pre className="diff-body" style={{ padding: '12px' }}>{content}</pre>
                    </div>
                  )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
