# Tạo ảnh cho bài đăng bằng API (Gemini)

**Ngày:** 2026-06-15
**Trạng thái:** Đã duyệt thiết kế, sẵn sàng lập kế hoạch triển khai

## Bối cảnh & vấn đề

Hiện "bài đăng" trong commons là các file Markdown thuần text (vd
`items/2026-06-01-launch/post.md`). Vòng đời: agent đề xuất proposal → người duyệt
merge → bấm **Publish** gửi webhook JSON (`content`/`text`) tới Make/Discord → đăng lên
LinkedIn/Facebook. Bài chỉ có chữ, đơn điệu.

Mục tiêu: cho phép agent **tạo ảnh** cho bài đăng bằng API tạo ảnh hiện đại, ảnh được
review cùng proposal và đính kèm khi publish.

## Quyết định đã chốt

- **Thời điểm tạo ảnh:** lúc agent soạn proposal (ảnh nằm trong worktree, người duyệt xem
  trước khi merge). Giữ đúng invariant cốt lõi: agent đề xuất, người duyệt merge.
- **Nhà cung cấp:** Google Gemini (Imagen / Nano Banana) làm mặc định, sau lưng một
  interface để có thể đổi provider.
- **Phạm vi:** lưu ảnh trong repo + hiển thị ở review UI **và** đính ảnh vào payload Publish.
- **Hướng kỹ thuật:** Hướng A — binary là công dân hạng nhất trong engine (ảnh nằm thẳng
  trong git). Loại Hướng B (lưu ảnh ngoài/host) vì phá vỡ tính tự-chứa của workspace và
  ảnh không được review tự nhiên cùng proposal.

## Ràng buộc quan trọng

Toàn bộ engine hiện đọc/ghi UTF-8 text (`readFile`, `writeProposalFile`, publish đọc text).
Ảnh là binary → phải thêm đường binary xuyên suốt: engine → API → web → publish, **giữ
nguyên** mọi hàm text cũ để không phá vỡ gì.

## Thiết kế

### Phần 1 — Lớp tạo ảnh (`src/image/`)

`src/image/generate.ts` định nghĩa interface provider-agnostic:

```ts
interface ImageGenerator {
  generate(opts: { prompt: string; aspectRatio?: '1:1' | '16:9' | '9:16' })
    : Promise<{ bytes: Buffer; mime: string }>;
}
```

`src/image/gemini.ts` cài đặt cho Gemini: đọc `GEMINI_API_KEY` từ env, gọi API, decode
base64 trả về thành `Buffer`. Thiếu key → ném lỗi rõ ràng. Tách riêng để đổi sang
OpenAI/FLUX chỉ cần thêm một file.

### Phần 2 — Engine hỗ trợ binary (`src/engine/index.ts` + `types.ts`)

Thêm, giữ nguyên các hàm text cũ:

- `writeProposalFileBytes(ws, id, path, bytes: Buffer)` — như `writeProposalFile` nhưng
  `writeFileSync(abs, bytes)` (không `'utf8'`). Vẫn qua `safeJoin` + guard status
  `merged/discarded`.
- `readFileBytes(ws, path): Buffer` và `readProposalFileBytes(ws, id, path): Buffer` — bỏ
  `'utf8'` để trả `Buffer`.

`diffProposal` không đổi (git tự in `Binary files ... differ`).

**Convention vị trí ảnh:** thư mục `assets/` của workspace (đã có trong `buildSeed`). Đặt
tên theo item, vd `assets/2026-06-01-launch/cover.png`. Mọi mutating call qua
`serializer.run`.

### Phần 3 — MCP tool `generate_image` (`src/mcp/tools.ts`)

Tool mới (vẫn KHÔNG có merge/discard):

```
name: 'generate_image'
inputSchema: { workspace, proposalId, prompt: string, path: string,
               aspectRatio?: '1:1' | '16:9' | '9:16' }
run: imageGenerator.generate({prompt, aspectRatio})
     → serializer.run(ws, () => engine.writeProposalFileBytes(ws, id, path, bytes))
     → trả "wrote <path> (<mime>, <kb>KB). Reference it as ![alt](<relative>)."
```

- `ImageGenerator` được tiêm vào `ToolDeps` (cạnh `engine`, `serializer`, `genId`) để test
  inject generator giả.
- Description hướng dẫn agent chèn `![alt](...)` vào `post.md` — đây là cách publish biết
  ảnh nào thuộc bài.
- Thiếu `GEMINI_API_KEY` → trả chuỗi lỗi rõ ràng (không throw).
- Đăng ký một chỗ trong `buildServer`, dùng cho cả stdio và http MCP.

### Phần 4 — API route phục vụ ảnh (`src/api/server.ts`)

- `GET /api/workspaces/:ws/proposals/:id/asset?path=` → `readProposalFileBytes`.
- `GET /api/workspaces/:ws/asset?path=` → `readFileBytes`.

Suy ra MIME từ đuôi file, `reply.type(mime).send(buffer)`, lỗi → 400 JSON. Route đọc,
không qua serializer.

### Phần 5 — Review UI hiển thị ảnh (`web/`)

1. Helper `isImage(path)` (`.png/.jpg/.jpeg/.webp/.gif`). File ảnh → bỏ fetch text, render
   `<img src={asset-endpoint}>` (Phần 4). Áp dụng cho cả `DiffView` (bản đọc proposal) và
   `FileBrowser` (main).
2. Ảnh nhúng trong markdown: `renderMarkdown` viết lại `src` tương đối của `<img>` thành URL
   asset-endpoint tuyệt đối theo đúng ws + context (proposal/main) → bài hiển thị inline ảnh
   đúng như sẽ đăng.
3. Bản "Thay đổi" (git diff) cho ảnh: hiển thị dòng "ảnh (xem ở Bản đọc)" thay cho
   `Binary files differ`.

### Phần 6 — Publish đính ảnh (`src/api/server.ts` + `PUBLISHING.md`)

Sửa `POST .../publish`:

1. Trích tham chiếu ảnh đầu tiên trong `content` bằng regex `!\[.*?\]\((.+?)\)`, resolve path
   tương đối về workspace path, qua `safeJoin`.
2. Có ảnh → `readFileBytes` → đính vào payload:
   ```jsonc
   { workspace, path, title, content, text,
     "image": { "filename": "cover.png", "mime": "image/png", "base64": "..." } }
   ```
   Không có ảnh → bỏ field `image` (tương thích ngược 100%).
3. Cập nhật `PUBLISHING.md` mô tả field `image` và cách map trong Make.

YAGNI: chưa nén/resize ảnh cho tới khi thực sự cần.

### Phần 7 — Test & xử lý lỗi

Theo pattern sẵn có (engine thật trên `mkdtemp`, không mock git):

- **engine.test.ts**: ghi/đọc binary round-trip qua proposal; merge ảnh vào main; bytes khớp.
- **api.test.ts**: route `/asset` trả đúng MIME + bytes; publish kèm `image` khi post có ảnh,
  không kèm khi không có (webhook giả).
- **MCP tool**: inject `ImageGenerator` giả → tool ghi đúng chỗ; thiếu API key → chuỗi lỗi rõ.
- `gemini.ts` (gọi mạng thật) không chạy trong CI (hoặc sau cờ env).

## Bất biến được giữ

Agent không bao giờ merge: `generate_image` chỉ ghi vào worktree proposal. Người duyệt vẫn
là cổng merge duy nhất, nay xem được cả ảnh trước khi duyệt.
