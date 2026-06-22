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
  const [webhookOpen, setWebhookOpen] = useState(false);
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

  // Close the publish/webhook popover on Escape or a click outside it.
  useEffect(() => {
    if (!webhookOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setWebhookOpen(false); };
    const onClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.webhook-wrap')) setWebhookOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [webhookOpen]);

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
  const pubCount = Object.keys(published).length;

  return (
    <div className="filespane">
      <div className="docs-toolbar">
        <div className="docs-toolbar__title">
          Tư liệu &amp; Bản thảo
          <small>brief · brand-voice · ghi chú · bản thảo (.md, .txt, .pdf, .docx)</small>
        </div>
        <div className="docs-toolbar__actions">
          <input ref={fileInput} type="file" accept=".md,.markdown,.txt,.pdf,.docx" style={{ display: 'none' }} onChange={onUpload} />
          <button className="btn save" disabled={uploading} onClick={() => fileInput.current?.click()}>
            {uploading ? 'Đang tải…' : '↑ Tải lên'}
          </button>
          <div className="webhook-wrap">
            <button className="btn ghost" aria-expanded={webhookOpen} aria-haspopup="dialog"
              onClick={() => setWebhookOpen((o) => !o)}>Đăng bài ▾</button>
            {webhookOpen && (
              <div className="webhook-popover" role="dialog" aria-label="Cấu hình đăng bài">
                <div className="webhook-popover__head">Cấu hình đăng bài</div>
                <label htmlFor="webhook-input">Webhook đăng bài</label>
                <input id="webhook-input" className="newinput"
                  placeholder="https://hook.make.com/... hoặc URL webhook Discord"
                  value={webhook} onChange={(e) => setWebhook(e.target.value)} />
                <div className="webhook-popover__row">
                  <button className="btn save" onClick={() => { void saveWebhook(); setWebhookOpen(false); }}>Lưu</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {uploadMsg && <p className={`notice notice--${uploadMsg.kind} notice--bar`} role="status">{uploadMsg.text}</p>}
      <div className="proposals">
        <div className="list">
          <h2>Mục lục</h2>
          {error && <p className="notice notice--error" role="alert">{error}</p>}
          {files === null && (
            <div className="sk-toc" aria-hidden>
              {['52%', '78%', '64%', '80%', '58%'].map((w, i) => (
                <div key={i} className="sk-line" style={{ width: w, height: i === 0 ? 14 : 12 }} />
              ))}
            </div>
          )}
          {files !== null && files.length === 0 && (
            <p className="empty">Chưa có tài liệu nào. <br />— dùng <b>↑ Tải lên</b> ở trên để thêm tư liệu nguồn.</p>
          )}
          {files !== null && files.length > 0 && (
            <>
              <FileTree
                nodes={tree}
                selected={selected}
                onSelect={setSelected}
                published={published}
              />
              <p className="list__colophon">
                {files.filter((f) => f.type !== 'dir').length} tài liệu
                {pubCount > 0 && <> · {pubCount} đã đăng</>}
              </p>
            </>
          )}
        </div>
        <div className="detail">
          {!selected && (
            <div className="doc-empty">
              <span className="doc-empty__ic" aria-hidden>▢</span>
              <p>Chọn một tài liệu để xem.</p>
            </div>
          )}
          {selected && (
            <>
              <div className="doc-folio">
                <span className="docpath">{selected}</span>
                <button className="btn reject ghost" onClick={onDelete}>Xóa tài liệu</button>
              </div>
              {isMd && (
                <div className="actions">
                  <button className="btn approve" disabled={publishing || !savedWebhook} onClick={doPublish}>
                    {pub ? 'Đăng lại' : 'Đăng bài'}
                  </button>
                  {!savedWebhook && <span className="empty">Mở “Đăng bài” ở trên để đặt webhook.</span>}
                  {pub && <span className="empty">Đăng lần cuối {new Date(pub.publishedAt).toLocaleString()}</span>}
                </div>
              )}
              {publishMsg && <p className={`notice notice--${publishMsg.kind}`} role="status">{publishMsg.text}</p>}
              {content === null && (
                <div className="doc-leaf sk-doc" aria-hidden>
                  <div className="sk-line" style={{ width: '55%', height: 22 }} />
                  {['100%', '96%', '90%', '93%', '40%'].map((w, i) => (
                    <div key={i} className="sk-line" style={{ width: w }} />
                  ))}
                </div>
              )}
              {content !== null && (
                isImage(selected)
                  ? <figure className="doc-leaf doc-leaf--image">
                      <img className="post-image" src={api.assetUrl(ws, selected)} alt={selected} />
                      <figcaption className="doc-leaf__caption">{selected}</figcaption>
                    </figure>
                  : isMd
                    ? <article className="doc-leaf">
                        <div className="doc" dangerouslySetInnerHTML={{ __html: renderMarkdown(content, resolvePostImage(selected, (p) => api.assetUrl(ws, p))) }} />
                      </article>
                    : <div className="doc-leaf doc-leaf--text"><pre className="doc-pre">{content}</pre></div>
              )}
            </>
          )}
        </div>
      </div>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
}
