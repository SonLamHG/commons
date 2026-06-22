# Tab tài liệu — Redesign "Reading Room" (C + A)

**Ngày:** 2026-06-22
**Phạm vi:** Nâng tầm thẩm mỹ tab tài liệu (`FileBrowser`) đồng bộ với ngôn ngữ
"Editorial Review Desk" đã thiết lập ở tab Proposals. Thuần CSS + cấu trúc JSX.
Không đụng API, logic nghiệp vụ, hay `tree.ts`.

## Mục tiêu

Đưa tab tài liệu lên cùng đẳng cấp thị giác với tab Proposals vừa redesign, với
điểm nhấn "tinh xảo cao nhất" ở vùng đọc tài liệu (tinh thần *Reading Room*).
Giữ nguyên toàn bộ luồng làm việc hiện tại (tìm → mở → đọc → đăng).

Hướng đã chốt: **C + A** — khung/chrome nối tiếp bàn duyệt (đồng bộ Proposals) +
vùng đọc nâng theo Reading Room.

## Files chạm tới

- `web/src/components/FileBrowser.tsx` — cấu trúc JSX (toolbar mới, popover webhook,
  folio, leaf, skeleton). Logic giữ nguyên.
- `web/src/components/FileTree.tsx` — cấu trúc rail "Mục lục" (leader dots, colophon).
- `web/src/styles.css` — phần lớn công việc; dùng design tokens sẵn có ở `:root`.
- `design/files-reading-room.html` (+ một bản refined) — HTML study tĩnh, dựng trước.

**Không chạm:** `src/api/*`, `src/engine/*`, `web/src/api.ts`, `web/src/tree.ts`,
`web/src/markdown.ts` (trừ khi cần class hook nhỏ), logic upload/publish/delete/webhook.

## Quy trình giao hàng

1. Dựng **2 bản HTML study tĩnh** trong `design/` để duyệt trực quan trước:
   - `files-reading-room.html` — bản chính thể hiện C+A.
   - một bản refined sau phản hồi.
2. Sau khi duyệt mockup → áp vào `FileBrowser.tsx` / `FileTree.tsx` / `styles.css`.
3. `npm test` đảm bảo `tree.test.ts` & `api.test.ts` không vỡ.

## Phần 1 — Bố cục & chrome tổng thể

Thay **2 thanh cũ** (`.webhookbar` + `.uploadbar`) bằng **một toolbar mảnh 1 dòng**:

- Trái: nhãn section "Tư liệu & Bản thảo" (serif nhỏ).
- Phải: nút **"↑ Tải lên"** gọn + nút **"Đăng bài ▾"** mở popover.
- Popover "Đăng bài" chứa: input URL webhook + nút **Lưu** (cấu hình hiếm dùng,
  giấu khỏi bề mặt chính). Đóng khi click ngoài / Esc.
- Nền `--paper-2`, hairline `--rule`, chiều cao thấp — trả không gian cho rail + vùng đọc.

Bố cục 2 cột giữ nguyên (`.proposals` → `.list` rail trái / `.detail` vùng đọc phải).
Rail đứng yên khi cuộn nội dung (đã đảm bảo ở commit `ecbdb9a`).

## Phần 2 — Rail trái "Mục lục"

- **Folder hàng đầu** (Tư liệu nguồn / Bản thảo / Hình ảnh): tiêu đề serif nhỏ in
  hoa nhẹ; spine accent màu theo section bên trái (kế thừa `data-accent` +
  `STANDARD_FOLDERS`); số đếm tệp dạng folio mảnh bên phải; chevron tinh, xoay mượt.
- **Hàng tệp**: tên tệp sans; **leader dots** mảnh nối tới nhãn `·pub` nếu đã đăng
  (gợi mục lục sách). Hàng đang chọn: nền `--paper-2` + viền trái mực đậm
  (không dùng highlight thô).
- **Trạng thái rỗng folder**: "— trống —" italic, faint.
- **Đáy rail**: dòng colophon mảnh "N tài liệu".

Hành vi giữ nguyên: click chọn, folder gập/mở (top folders mở mặc định).

## Phần 3 — Vùng đọc "Reading Room"

- **Folio đầu trang**: đường dẫn tài liệu thành dòng chỉ mảnh (mono nhỏ, faint),
  dính trên cùng như tiêu đề chạy. Nút "Xóa tài liệu" ghost mảnh nép phải.
- **Trang giấy ("leaf")**: nội dung canh giữa, `max-width ~680px` (dòng đọc ~70 ký
  tự, hẹp hơn 1040px hiện tại); nền `--paper-2`; `--shadow-md` rất nhẹ; lề trong rộng.
- **Drop-cap**: chữ đầu đoạn văn đầu tiên thả 2–3 dòng, serif Fraunces; chỉ áp cho
  `.md` qua CSS `::first-letter`.
- **Typography**: heading serif; body tăng `line-height` & cỡ chữ; blockquote có
  thanh mực trái; `hr` thành asterism (dấu hoa thị căn giữa).
- **Thao tác đăng bài**: dải `.actions` giữ nguyên logic (Đăng / Đăng lại; disable
  khi chưa có webhook; hiển thị thời gian đăng cuối) nhưng restyle gọn dưới folio.
- **Ảnh & non-md**: ảnh canh giữa có khung giấy mảnh + caption tên tệp; tệp text
  giữ `<pre>` trong khung leaf.

## Phần 4 — Trạng thái, lỗi

- **Loading**: skeleton nhịp giấy (vài thanh mờ) cho rail và vùng đọc thay "Đang tải…".
- **Empty**: chưa chọn → "Chọn một tài liệu để xem." căn giữa, italic faint, icon
  trang giấy mảnh. Workspace rỗng → "Chưa có tài liệu nào." + gợi ý tải lên.
- **Notice**: giữ component `notice`, chỉ chỉnh vị trí cho hợp toolbar mới.

## Không làm (YAGNI)

Không thêm tìm kiếm tệp, kéo-thả sắp xếp, sửa nhiều tệp, preview PDF/docx, hay đổi
bất kỳ endpoint/logic nào. Thuần lớp trình bày.

## Kiểm thử

- `npm test` xanh (`tree.test.ts`, `api.test.ts` không bị ảnh hưởng vì không đổi logic).
- Kiểm bằng mắt trên `npm run dev`: toolbar/popover, rail accent + leader dots, drop-cap,
  leaf canh giữa, skeleton, các trạng thái empty/ảnh/non-md.
