import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, type FileNode, isImage } from '../api';
import { renderMarkdown, resolvePostImage } from '../markdown';
import { buildTree } from '../tree';
import { FileTree } from './FileTree';
import { ConfirmDialog, type ConfirmRequest } from './ConfirmDialog';

type Notice = { kind: 'ok' | 'error'; text: string };

export function FileBrowser({ ws }: { ws: string }) {
  const [files, setFiles] = useState<FileNode[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [webhook, setWebhook] = useState('');
  const [savedWebhook, setSavedWebhook] = useState<string | undefined>(undefined);
  const [published, setPublished] = useState<Record<string, { publishedAt: string }>>({});
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<Notice | null>(null);
  const [uploadMsg, setUploadMsg] = useState<Notice | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadFiles = () => api.state(ws).then((nodes) => setFiles(nodes))
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
    if (isImage(selected)) { setContent(''); return; }
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
      setPublishMsg({ kind: 'ok', text: 'Đã lưu webhook.' });
    } catch (e) { setPublishMsg({ kind: 'error', text: e instanceof Error ? e.message : String(e) }); }
  };

  const doPublish = async () => {
    if (!selected) return;
    setPublishing(true); setPublishMsg(null);
    try {
      await api.publish(ws, selected);
      api.published(ws).then(setPublished).catch(() => {});
      setPublishMsg({ kind: 'ok', text: 'Đã đăng ✓' });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      let msg = raw; try { msg = JSON.parse(raw).error ?? raw; } catch { /* keep raw */ }
      setPublishMsg({ kind: 'error', text: 'Đăng thất bại: ' + msg });
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
      setUploadMsg({ kind: 'ok', text: `Đã thêm ${path} — agent có thể đọc làm ngữ cảnh.` });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let msg = raw; try { msg = JSON.parse(raw).error ?? raw; } catch { /* keep raw */ }
      setUploadMsg({ kind: 'error', text: 'Tải lên lỗi: ' + msg });
    } finally { setUploading(false); }
  };

  const doDelete = async (path: string) => {
    try {
      await api.deleteFile(ws, path);
      setSelected(null); setContent(null);
      await loadFiles();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      let msg = raw; try { msg = JSON.parse(raw).error ?? raw; } catch { /* keep raw */ }
      setError('Xóa lỗi: ' + msg);
    }
  };

  const onDelete = () => {
    if (!selected) return;
    const path = selected;
    setConfirm({
      title: 'Xóa tài liệu?',
      body: <><code>{path}</code> sẽ bị xóa — <b>không hoàn tác được</b>.</>,
      confirmLabel: 'Xóa tài liệu',
      onConfirm: () => { void doDelete(path); },
    });
  };

  const tree = useMemo(() => buildTree(files ?? []), [files]);
  const isMd = !!selected && selected.endsWith('.md');
  const pub = selected ? published[selected] : undefined;

  return (
    <div>
      <div className="webhookbar">
        <label>Webhook đăng bài</label>
        <input className="newinput" placeholder="https://hook.make.com/... hoặc URL webhook Discord"
          value={webhook} onChange={(e) => setWebhook(e.target.value)} />
        <button className="btn save" onClick={saveWebhook}>Lưu</button>
      </div>
      <div className="uploadbar">
        <div>
          <strong>Tư liệu nguồn</strong>
          <span className="empty"> — brief, brand-voice, ghi chú (.md, .txt, .pdf, .docx)</span>
        </div>
        <input ref={fileInput} type="file" accept=".md,.markdown,.txt,.pdf,.docx" style={{ display: 'none' }} onChange={onUpload} />
        <button className="btn save" disabled={uploading} onClick={() => fileInput.current?.click()}>
          {uploading ? 'Đang tải…' : '↑ Tải tài liệu lên'}
        </button>
      </div>
      {uploadMsg && <p className={`notice notice--${uploadMsg.kind} notice--bar`} role="status">{uploadMsg.text}</p>}
      <div className="proposals">
        <div className="list">
          <h2>Tài liệu</h2>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {files === null && <p className="empty">Đang tải…</p>}
          {files !== null && files.length === 0 && <p className="empty">Chưa có tài liệu nào.</p>}
          {files !== null && files.length > 0 && (
            <FileTree
              nodes={tree}
              selected={selected}
              onSelect={setSelected}
              published={published}
            />
          )}
        </div>
        <div className="detail">
          {!selected && <p className="empty">Chọn một tài liệu để xem.</p>}
          {selected && (
            <>
              <div className="detailbar">
                <span className="docpath">{selected}</span>
                <button className="btn reject ghost" onClick={onDelete}>Xóa tài liệu</button>
              </div>
              {isMd && (
                <div className="actions">
                  <button className="btn approve" disabled={publishing || !savedWebhook} onClick={doPublish}>
                    {pub ? 'Đăng lại' : 'Đăng bài'}
                  </button>
                  {!savedWebhook && <span className="empty">Đặt webhook ở trên để đăng bài.</span>}
                  {pub && <span className="empty">Đăng lần cuối {new Date(pub.publishedAt).toLocaleString()}</span>}
                </div>
              )}
              {publishMsg && <p className={`notice notice--${publishMsg.kind}`} role="status">{publishMsg.text}</p>}
              {content === null && <p className="empty">Đang tải…</p>}
              {content !== null && (
                isImage(selected)
                  ? <img className="post-image" src={api.assetUrl(ws, selected)} alt={selected} />
                  : isMd
                    ? <div className="doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(content, resolvePostImage(selected, (p) => api.assetUrl(ws, p))) }} />
                    : (
                      <div className="diff-file">
                        <h4>{selected}</h4>
                        <pre className="diff-body diff-body--pad">{content}</pre>
                      </div>
                    )
              )}
            </>
          )}
        </div>
      </div>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
