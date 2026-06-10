# FINDINGS — Nhật ký ma sát khi dùng thật

> Mục đích: leader chấm dự án ở **những gì bạn phát hiện**, không phải số feature. File này là "đồ thị nội bộ" — mỗi dòng là một lần `commons` làm bạn (hoặc người thứ 2) khó chịu khi dùng cho việc tri thức **thật**.
>
> Luật: **không sửa code khi đang dogfood.** Chỉ ghi. Sửa là việc của Giai đoạn 2, và chỉ sửa những gì xuất hiện ở đây.

## Cách ghi một finding

```
### F-NN — <tiêu đề ngắn>
- **Khi nào:** kịch bản nào / bước nào (link tới SCENARIOS.md nếu có)
- **Kỳ vọng:** tôi tưởng nó sẽ...
- **Thực tế:** nhưng nó...
- **Mức đau:** blocker | bực | gợn nhẹ
- **Giả thuyết:** vì sao (nếu đoán được)
- **Ai gặp:** tôi | người thứ 2 (non-dev)
```

---

## Findings

<!-- Bắt đầu ghi từ đây. Đừng tự kiểm duyệt — "gợn nhẹ" cũng đáng ghi. -->

### F-06 — Upload PDF scan → lưu file RỖNG, và tên tiếng Việt bị nuốt  ✅ ĐÃ VÁ (vòng dogfood 2)
- **Khi nào:** upload `yêu cầu.pdf` (PDF scan/ảnh) → mở ra trống; tên lưu thành `yu cu.md`.
- **2 bug:** (1) PDF không có lớp text → pdf-parse trả rỗng → hệ thống **âm thầm lưu 0 byte**. (2) bộ sanitize tên xoá ký tự có dấu tiếng Việt.
- **Fix:** extractText nay **throw** khi text rỗng (PDF kèm gợi ý "scan/ảnh, cần OCR") → API trả 400, không lưu file trống. referencePath giữ Unicode (`\p{L}\p{N}`). 68/68 test (thêm case empty-PDF + tên tiếng Việt). Dọn file rỗng đã lỡ commit.
- **Còn lại:** OCR cho PDF scan = chưa hỗ trợ (ghi ở KNOWN_LIMITATIONS #4).
- **Ai gặp:** tôi (đóng vai marketer)

### F-05 — Nội dung trông như CODE, không như tài liệu của marketer  ⭐ ✅ ĐÃ VÁ (reading view — Giai đoạn 2)
> Fix: (1) tab Files render markdown → tài liệu định dạng (`.doc`, serif headings, không còn `<pre>` mono cho .md). (2) Review có toggle **Bản đọc** (mặc định — render bản cuối đề xuất như bản thảo) / **Thay đổi** (giữ git diff). Hạ tầng: engine `readProposalFile` + API `GET .../proposals/:id/file` + bộ render markdown an toàn `web/src/markdown.ts` (escape HTML trước). 55/55 test, verify bằng screenshot live. CÒN LẠI (nếu cần độ bóng): redline mức chữ (track-changes) — đã có lựa chọn, để dành.
- **Khi nào:** tab Files (markdown thô trong `<pre>` mono) + review diff (git diff `+`/`-`, `@@`, `diff --git`)
- **Kỳ vọng:** một marketer xem thấy *tài liệu định dạng* và *thay đổi mức câu/chữ* (như Google Docs / Word track-changes).
- **Thực tế:** thấy markdown thô + git diff — ngôn ngữ lập trình viên rò rỉ ra ngoài.
- **Mức đau:** blocker chiến lược
- **Giả thuyết:** đây là điểm phân biệt "GitHub re-skin" vs "công cụ marketer thật sự hiểu". Cần render markdown→tài liệu, và redline mức chữ thay vì diff dòng. ĐÒN BẨY CAO NHẤT tới giờ.
- **Ai gặp:** tôi (đóng vai nhân viên marketing)

### F-04 — Không có chỗ upload tài liệu sẵn có  ✅ ĐÃ VÁ (Giai đoạn 2)
> Fix: nút **Upload tài liệu** ở tab Files nhận .md/.txt/**.pdf/.docx**; trích xuất text (pdf-parse + mammoth) → ghi `reference/<tên>.md` thẳng vào main (bỏ qua cổng duyệt — đúng triết lý: cổng gác đề xuất của AI, không gác đầu vào của người). Agent đọc được ngay qua `read_file`. Hạ tầng: engine `addFile`, `src/upload/extract.ts`, API `POST .../files` (multipart), client `uploadFile`. 65/65 test + verify live (upload brief.md → render thành tài liệu). Caveat: PDF/DOCX chỉ lấy text (mất ảnh/định dạng) — xem KNOWN_LIMITATIONS.
- **Khi nào:** marketer có brief/draft/brand-guide sẵn, muốn đưa vào workspace
- **Kỳ vọng:** kéo-thả / upload file vào workspace.
- **Thực tế:** nội dung CHỈ vào được qua agent (MCP). Con người không có đường đưa tư liệu vào.
- **Mức đau:** bực (chặn usability cho non-dev)
- **Giả thuyết:** Tách 2 nghĩa — (a) upload làm **tư liệu nguồn** cho agent đọc (an toàn, fit governance) vs (b) upload thẳng vào main (phá cổng duyệt). Làm (a) trước.
- **Ai gặp:** tôi (đóng vai nhân viên marketing)

### F-01 — Giao diện xấu  ✅ ĐÃ VÁ (Giai đoạn 2)
> Fix: thiết kế lại toàn bộ review UI theo hướng "Editorial Review Desk" (letterpress/newsroom) — font Fraunces (serif masthead) + Hanken Grotesk + JetBrains Mono; palette giấy ấm/mực/vermilion; badge trạng thái kiểu **con dấu cao su** (con dấu lớn nghiêng ở header review); masthead serif có tagline + gáy vermilion; diff tinh chỉnh. Chỉ sửa lớp thị giác (styles.css + index.html fonts), giữ nguyên 100% class name & logic. Build OK, verify bằng screenshot live. Còn lại: chạy S3 với người thứ 2 để xem có còn "rào tâm lý" không.
- **Khi nào:** review UI nói chung (vòng dogfood 1)
- **Kỳ vọng:** một UI đủ tin cậy để đưa cho người thứ 2 (S3).
- **Thực tế:** xấu — đủ để mình bực, và là rào cản tâm lý khi đưa cho non-dev.
- **Mức đau:** bực
- **Giả thuyết:** CSS plain, chưa có hệ thống thị giác (spacing/typography/màu). Không phải lỗi chức năng.
- **Ai gặp:** tôi

### F-02 — Mới có Discord, cần Make → LinkedIn / Facebook / ...  ✅ ĐÃ VÁ (Giai đoạn 2)
> Fix: payload publish thêm field `text` = bản plain-text (strip markdown) để Make map thẳng vào LinkedIn/FB không lộ `#`/`**`; giữ `content` thô cho Discord. Thêm helper `src/publish/markdown.ts` (test markdown.test.ts) + assert trong api.test.ts. Hướng dẫn nối Make→LinkedIn/FB ở [PUBLISHING.md](PUBLISHING.md). 52/52 pass.
> Còn lại (phần ngoài code, việc của bạn): dựng scenario trên Make + authorize LinkedIn/FB rồi verify end-to-end.
- **Khi nào:** bước publish (S1)
- **Kỳ vọng:** publish thẳng ra kênh thật (LinkedIn, FB), không chỉ Discord.
- **Thực tế:** webhook mới chỉ verify với Discord trực tiếp.
- **Mức đau:** bực (chặn "lý do tồn tại" = external action thật)
- **Giả thuyết:** payload generic đã sẵn; thiếu phần map qua Make và xác nhận end-to-end tới LinkedIn/FB.
- **Ai gặp:** tôi

### F-03 — Agent (qua MCP) không biết dự án hiện đang có gì → phải quay lại web để xem  ✅ ĐÃ VÁ (Giai đoạn 2)
> Fix: thêm 2 MCP tool `overview` (snapshot mọi workspace + số file + số proposal chờ duyệt; mô tả "START HERE") và `list_workspaces`. Agent giờ có điểm vào để tự định hướng, không cần con người làm cầu nối. Test: mcp-tools.test.ts, mcp-server.test.ts. 47/47 pass.
- **Khi nào:** dùng Claude Desktop với MCP đã cắm (S1/S2)
- **Kỳ vọng:** ngồi trong Claude là đủ ngữ cảnh — agent tự biết có workspace nào, file nào, proposal nào đang chờ.
- **Thực tế:** agent mù; mình phải mở web để biết trạng thái rồi nói lại cho agent. Hai bề mặt bị đứt gãy.
- **Mức đau:** blocker (về trải nghiệm — phá vỡ mô hình "agent điều khiển")
- **Giả thuyết:** MCP **thiếu tool `list_workspaces`** (và có thể thiếu một tool "overview" gộp). Agent không có điểm vào để khám phá trạng thái, buộc con người làm cầu nối.
- **Ai gặp:** tôi

---

## Tổng kết sau mỗi vòng dogfood

| Vòng | Ngày | Ai dùng | Kịch bản chạy | # blocker | # bực | # gợn |
|------|------|---------|----------------|-----------|-------|-------|
|      |      |         |                |           |       |       |

### 3 điều đau nhất (cập nhật sau mỗi vòng)
1.
2.
3.
