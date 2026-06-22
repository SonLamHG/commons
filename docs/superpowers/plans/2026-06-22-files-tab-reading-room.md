# Tab tài liệu — Reading Room Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng tầm thẩm mỹ tab tài liệu (`FileBrowser`) lên ngôn ngữ "Editorial Review Desk", với vùng đọc theo tinh thần Reading Room — thuần CSS + cấu trúc JSX.

**Architecture:** Dựng HTML study tĩnh trong `design/` để chốt trực quan trước, rồi áp vào `FileBrowser.tsx` / `FileTree.tsx` / `styles.css`. Không đụng API, engine, hay logic nghiệp vụ. Tái dùng design tokens ở `:root` của `styles.css`.

**Tech Stack:** React 19 + Vite, CSS thuần (design tokens biến CSS), vitest.

## Global Constraints

- **Không đổi logic/API:** không chạm `src/api/*`, `src/engine/*`, `web/src/api.ts`, `web/src/tree.ts`. Giữ nguyên hành vi upload/publish/delete/webhook/select.
- **Dùng tokens sẵn có:** màu/bóng/font lấy từ `:root` trong `web/src/styles.css` (`--paper`, `--paper-2`, `--ink`, `--ink-soft`, `--ink-faint`, `--rule`, `--vermilion`, `--forest`, `--amber`, `--shadow-sm/md`, `--serif/sans/mono`). Không thêm bảng màu mới trừ khi thật cần.
- **Copy tiếng Việt** giữ giọng hiện tại (vd "Tải tài liệu lên", "Đăng bài", "Chọn một tài liệu để xem.").
- **Test gate mỗi task:** `npm test` phải xanh (không được làm vỡ `tree.test.ts`, `api.test.ts`) + kiểm thị giác.
- **Windows:** commit message dùng heredoc; LF→CRLF warning là bình thường.

---

### Task 1: HTML study tĩnh (R&D mockup — review gate)

Dựng bản mockup tĩnh thể hiện toàn bộ hướng C+A để duyệt trực quan trước khi đụng React. Đây là cổng review quan trọng nhất.

**Files:**
- Create: `design/files-reading-room.html`

**Interfaces:**
- Consumes: design tokens + thẩm mỹ từ `design/review-desk-p0-refined.html` và `web/src/styles.css` (`:root`).
- Produces: bảng giá trị thị giác (spacing, max-width leaf, kiểu leader dots, drop-cap, folio) mà Task 2–5 sẽ copy sang `styles.css`.

- [ ] **Step 1: Đọc tham chiếu**

Đọc `design/review-desk-p0-refined.html` (ngôn ngữ desk đã chốt) và `web/src/styles.css` dòng 1–90 (tokens) + các rule `.filespane/.proposals/.list/.detail/.tree-*/.doc` hiện có.

- [ ] **Step 2: Viết `design/files-reading-room.html`**

Một file HTML tự chứa (inline `<style>`, copy `:root` tokens). Phải thể hiện đủ:
- Toolbar mảnh 1 dòng: nhãn "Tư liệu & Bản thảo" trái; "↑ Tải lên" + "Đăng bài ▾" phải; popover webhook (hiện sẵn 1 trạng thái mở để xem).
- Rail "MỤC LỤC": 3 folder top (Tư liệu nguồn / Bản thảo / Hình ảnh) có spine accent màu, count folio, chevron; hàng tệp có leader dots + nhãn `·pub`; 1 hàng đang chọn (viền trái mực); colophon đáy "N tài liệu".
- Vùng đọc: folio đường dẫn dính trên; leaf canh giữa `max-width:680px` nền `--paper-2` bóng nhẹ; drop-cap đoạn đầu (serif); heading serif; blockquote thanh mực; `hr` asterism; dải `.actions` Đăng bài.
- Dùng dữ liệu giả (vài đoạn markdown đã render thành HTML tĩnh) để thấy drop-cap & nhịp đọc.

- [ ] **Step 3: Mở xem trong trình duyệt**

Run: `start design/files-reading-room.html` (Windows) — kiểm mắt: toolbar cân đối, leader dots thẳng, drop-cap đẹp, leaf không quá rộng.

- [ ] **Step 4: Commit**

```bash
git add design/files-reading-room.html
git commit -m "$(cat <<'EOF'
docs(design): add Files tab Reading Room HTML study

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: REVIEW GATE — chờ người dùng duyệt mockup**

Dừng và xin người dùng xem `design/files-reading-room.html`. Chỉ qua Task 2 sau khi được duyệt (có thể cần một bản refined — nếu vậy lặp Step 2–4 với `design/files-reading-room-refined.html`).

---

### Task 2: Toolbar mảnh + popover Webhook (FileBrowser chrome)

Thay `.webhookbar` + `.uploadbar` bằng một toolbar 1 dòng; webhook chuyển vào popover sau nút "Đăng bài ▾". Logic không đổi.

**Files:**
- Modify: `web/src/components/FileBrowser.tsx` (vùng JSX dòng ~112–130, thêm state mở popover)
- Modify: `web/src/styles.css` (thêm rule `.docs-toolbar`, `.webhook-popover`; bỏ/giữ lại `.webhookbar`/`.uploadbar` nếu không còn dùng)

**Interfaces:**
- Consumes: state & handler sẵn có (`webhook`, `setWebhook`, `saveWebhook`, `savedWebhook`, `onUpload`, `uploading`, `fileInput`).
- Produces: cấu trúc DOM mới `.docs-toolbar` mà Task 5 (notice) tham chiếu để đặt vị trí thông báo.

- [ ] **Step 1: Thêm state popover trong `FileBrowser`**

```tsx
const [webhookOpen, setWebhookOpen] = useState(false);
```

- [ ] **Step 2: Thay 2 thanh cũ bằng toolbar**

Thay khối JSX `.webhookbar` + `.uploadbar` (dòng ~114–129) bằng:

```tsx
<div className="docs-toolbar">
  <strong className="docs-toolbar__title">Tư liệu &amp; Bản thảo</strong>
  <div className="docs-toolbar__actions">
    <input ref={fileInput} type="file" accept=".md,.markdown,.txt,.pdf,.docx"
      style={{ display: 'none' }} onChange={onUpload} />
    <button className="btn save" disabled={uploading} onClick={() => fileInput.current?.click()}>
      {uploading ? 'Đang tải…' : '↑ Tải lên'}
    </button>
    <div className="webhook-wrap">
      <button className="btn ghost" aria-expanded={webhookOpen}
        onClick={() => setWebhookOpen((o) => !o)}>Đăng bài ▾</button>
      {webhookOpen && (
        <div className="webhook-popover" role="dialog">
          <label>Webhook đăng bài</label>
          <input className="newinput" placeholder="https://hook.make.com/... hoặc URL webhook Discord"
            value={webhook} onChange={(e) => setWebhook(e.target.value)} />
          <button className="btn save" onClick={() => { void saveWebhook(); setWebhookOpen(false); }}>Lưu</button>
        </div>
      )}
    </div>
  </div>
</div>
```

- [ ] **Step 3: Đóng popover khi click ngoài / Esc**

Thêm effect trong `FileBrowser`:

```tsx
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
```

- [ ] **Step 4: Style toolbar + popover**

Trong `styles.css`, thêm (copy giá trị từ HTML study Task 1):

```css
.docs-toolbar { display:flex; align-items:center; justify-content:space-between;
  padding:10px 18px; background:var(--paper-2); border-bottom:1px solid var(--rule); }
.docs-toolbar__title { font-family:var(--serif); font-weight:600; font-size:15px; }
.docs-toolbar__actions { display:flex; align-items:center; gap:10px; }
.webhook-wrap { position:relative; }
.webhook-popover { position:absolute; right:0; top:calc(100% + 8px); z-index:20;
  width:340px; padding:14px; background:var(--paper-2); border:1px solid var(--rule);
  border-radius:8px; box-shadow:var(--shadow-md); display:flex; flex-direction:column; gap:8px; }
.webhook-popover label { font-size:12px; color:var(--ink-soft); }
```

Xóa rule `.webhookbar`, `.uploadbar` nếu không còn JSX nào dùng (Grep xác nhận trước khi xóa).

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS (toàn bộ). Sau đó `npm run dev`, kiểm: toolbar 1 dòng, popover mở/đóng đúng (Esc + click ngoài), upload vẫn chạy, lưu webhook vẫn chạy.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/FileBrowser.tsx web/src/styles.css
git commit -m "$(cat <<'EOF'
feat(web): slim toolbar + webhook popover for Files tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Rail "Mục lục" (FileTree)

Restyle cây thư mục thành mục lục: leader dots, accent spine, colophon đáy. Cấu trúc/hành vi giữ nguyên, chủ yếu CSS + nhãn h2.

**Files:**
- Modify: `web/src/components/FileBrowser.tsx` (h2 "Tài liệu" → "Mục lục"; thêm colophon đáy `.list`)
- Modify: `web/src/components/FileTree.tsx` (markup leader dots nếu cần wrapper)
- Modify: `web/src/styles.css` (`.tree-folder*`, `.tree-file*`, `.tree-tag`, thêm `.tree-leader`, `.list__colophon`)

**Interfaces:**
- Consumes: `tree` (TreeNode[]), `published`, `selected`, `files.length` đã có trong `FileBrowser`.
- Produces: không có API mới; chỉ class CSS.

- [ ] **Step 1: Đổi tiêu đề rail + thêm colophon**

Trong `FileBrowser.tsx` khối `.list`: đổi `<h2>Tài liệu</h2>` → `<h2>Mục lục</h2>`; ngay trước `</div>` đóng `.list`, thêm:

```tsx
{files !== null && files.length > 0 && (
  <p className="list__colophon">{files.length} tài liệu</p>
)}
```

- [ ] **Step 2: Leader dots cho hàng tệp**

Trong `FileTree.tsx` `FileRow`, bọc tên + tag để leader dots chèn giữa:

```tsx
<button className={`tree-file${active ? ' is-active' : ''}`} onClick={() => onSelect(node.path)}>
  <span className="tree-file__name">{node.name}</span>
  <span className="tree-leader" aria-hidden />
  {published[node.path] && <span className="tree-tag">·pub</span>}
</button>
```

- [ ] **Step 3: Style rail**

Trong `styles.css` cập nhật/thêm (copy từ HTML study):

```css
.tree-file { display:flex; align-items:center; gap:6px; }
.tree-file__name { flex:0 0 auto; }
.tree-leader { flex:1 1 auto; border-bottom:1px dotted var(--rule); transform:translateY(-2px); margin:0 4px; }
.tree-file.is-active { background:var(--paper-2); border-left:2px solid var(--ink); }
.tree-folder--top .tree-folder__name { font-family:var(--serif); text-transform:uppercase;
  letter-spacing:.04em; font-size:12.5px; }
.list__colophon { margin-top:14px; padding-top:10px; border-top:1px solid var(--rule);
  font-size:11px; color:var(--ink-faint); font-style:italic; }
```

Giữ nguyên `data-accent` spine hiện có; nếu chưa nổi accent, thêm `.tree-folder--top[data-accent] { border-left:2px solid; }` map màu theo `STANDARD_FOLDERS`.

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: PASS (`tree.test.ts` không đổi logic). `npm run dev`: rail hiện leader dots thẳng, accent folder, hàng chọn có viền trái, colophon đáy.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FileBrowser.tsx web/src/components/FileTree.tsx web/src/styles.css
git commit -m "$(cat <<'EOF'
feat(web): restyle Files rail as a table-of-contents

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Vùng đọc "Reading Room"

Folio đường dẫn dính trên, leaf canh giữa hẹp, drop-cap, typography ấn phẩm, ảnh/non-md có khung.

**Files:**
- Modify: `web/src/components/FileBrowser.tsx` (cấu trúc `.detail` — folio + bọc leaf)
- Modify: `web/src/styles.css` (`.detail`, `.doc`, thêm `.doc-folio`, `.doc-leaf`, drop-cap, asterism, `.post-image` caption)

**Interfaces:**
- Consumes: `selected`, `content`, `isMd`, `isImage`, `pub`, `savedWebhook`, `publishing`, `doPublish`, `onDelete` đã có.
- Produces: lớp DOM `.doc-leaf` bọc nội dung — Task 5 skeleton dùng cùng container.

- [ ] **Step 1: Cấu trúc folio + leaf**

Trong `.detail`, thay `.detailbar` + nội dung bằng: dòng folio (đường dẫn + nút Xóa ghost), rồi bọc nội dung md/ảnh/pre trong `<div className="doc-leaf">`. Giữ nguyên logic điều kiện `isImage`/`isMd`/else và dải `.actions`. Ví dụ folio:

```tsx
<div className="doc-folio">
  <span className="docpath">{selected}</span>
  <button className="btn reject ghost" onClick={onDelete}>Xóa tài liệu</button>
</div>
```

Và đổi `max-width` container bằng class leaf thay vì `.detail > *` rule cũ.

- [ ] **Step 2: Style leaf + folio**

```css
.doc-folio { position:sticky; top:0; z-index:5; display:flex; align-items:center;
  justify-content:space-between; padding:10px 0; background:var(--paper);
  border-bottom:1px solid var(--rule); }
.doc-folio .docpath { font-family:var(--mono); font-size:12px; color:var(--ink-faint); }
.doc-leaf { max-width:680px; margin:22px auto; padding:40px 48px; background:var(--paper-2);
  box-shadow:var(--shadow-md); border:1px solid var(--rule-soft); border-radius:4px; }
```

(Điều chỉnh rule `.detail > * { max-width:1040px }` cũ để không ép leaf rộng — đổi sang nhắm `.doc-folio, .actions` hoặc bỏ.)

- [ ] **Step 3: Drop-cap + typography ấn phẩm**

```css
.doc-leaf .doc > p:first-of-type::first-letter { font-family:var(--serif); font-weight:600;
  float:left; font-size:3.1em; line-height:.82; padding:6px 8px 0 0; color:var(--ink); }
.doc-leaf .doc { line-height:1.7; font-size:16.5px; }
.doc-leaf .doc h1,.doc-leaf .doc h2,.doc-leaf .doc h3 { font-family:var(--serif); }
.doc-leaf .doc blockquote { border-left:3px solid var(--ink-soft); margin-left:0; padding-left:16px; color:var(--ink-soft); }
.doc-leaf .doc hr { border:none; text-align:center; }
.doc-leaf .doc hr::before { content:"⁂"; color:var(--ink-faint); font-size:18px; }
```

- [ ] **Step 4: Ảnh & non-md trong leaf**

Đảm bảo nhánh ảnh và `<pre>` nằm trong `.doc-leaf`; thêm caption ảnh:

```css
.doc-leaf .post-image { display:block; max-width:100%; margin:0 auto; border:1px solid var(--rule); }
```

- [ ] **Step 5: Verify**

Run: `npm test`
Expected: PASS. `npm run dev`: chọn 1 `.md` → leaf canh giữa, drop-cap đoạn đầu, folio dính khi cuộn; chọn ảnh → canh giữa có khung; chọn `.txt` → pre trong leaf; Đăng bài vẫn hoạt động.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/FileBrowser.tsx web/src/styles.css
git commit -m "$(cat <<'EOF'
feat(web): Reading Room document pane with folio, leaf, drop-cap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Trạng thái loading/empty (skeleton + restyle)

Thay "Đang tải…" thô bằng skeleton; làm đẹp empty states; chỉnh vị trí notice cho hợp toolbar.

**Files:**
- Modify: `web/src/components/FileBrowser.tsx` (nhánh `files === null`, `content === null`, empty states, vị trí `uploadMsg`/`publishMsg`)
- Modify: `web/src/styles.css` (thêm `.skeleton`, `.doc-empty`)

**Interfaces:**
- Consumes: `files`, `content`, `selected` states. Tái dùng class skeleton nếu đã tồn tại trong codebase (Grep `skeleton` trước; nếu có, dùng lại).

- [ ] **Step 1: Kiểm skeleton sẵn có**

Grep `skeleton` trong `web/src`. Nếu đã có component/class, tái dùng. Nếu chưa, thêm CSS:

```css
.skeleton { background:linear-gradient(90deg,var(--rule-soft),var(--paper-2),var(--rule-soft));
  background-size:200% 100%; animation:sk 1.2s ease-in-out infinite; border-radius:4px; height:12px; margin:8px 0; }
@keyframes sk { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
```

- [ ] **Step 2: Skeleton cho rail & vùng đọc**

Thay `{files === null && <p className="empty">Đang tải…</p>}` bằng vài `<div className="skeleton" />` (3–5 thanh). Tương tự thay `{content === null && <p className="empty">Đang tải…</p>}` trong leaf bằng skeleton.

- [ ] **Step 3: Empty states đẹp hơn**

Nhánh `!selected`:

```tsx
<div className="doc-empty"><span aria-hidden>▢</span><p>Chọn một tài liệu để xem.</p></div>
```

```css
.doc-empty { display:flex; flex-direction:column; align-items:center; justify-content:center;
  height:60%; color:var(--ink-faint); font-style:italic; gap:8px; }
.doc-empty span { font-size:32px; opacity:.5; }
```

Giữ "Chưa có tài liệu nào." cho workspace rỗng, có thể thêm gợi ý "— dùng ↑ Tải lên".

- [ ] **Step 4: Verify**

Run: `npm test`
Expected: PASS. `npm run dev` (throttle network nếu cần): thấy skeleton khi tải; empty state căn giữa; notice hiện đúng chỗ.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FileBrowser.tsx web/src/styles.css
git commit -m "$(cat <<'EOF'
feat(web): skeletons and refined empty states for Files tab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Phần 1 (bố cục/chrome/toolbar/popover) → Task 2. ✓
- Phần 2 (rail Mục lục, leader dots, accent, colophon) → Task 3. ✓
- Phần 3 (folio, leaf, drop-cap, typography, ảnh/non-md, actions) → Task 4. ✓
- Phần 4 (skeleton, empty, notice) → Task 5. ✓
- Quy trình HTML study trước → Task 1 (review gate). ✓
- "Không làm" (YAGNI) → tôn trọng; không task nào thêm search/drag/preview. ✓

**Placeholder scan:** Không có TBD/TODO; mọi step CSS/JSX đều có code thật. Giá trị spacing/màu copy từ HTML study Task 1 (chủ ý — study là nguồn chân lý thị giác).

**Type consistency:** Class names nhất quán giữa các task (`.docs-toolbar`, `.webhook-popover`, `.webhook-wrap`, `.tree-leader`, `.list__colophon`, `.doc-folio`, `.doc-leaf`, `.doc-empty`, `.skeleton`). State `webhookOpen` chỉ dùng trong Task 2. Không tham chiếu hàm/biến chưa định nghĩa.
