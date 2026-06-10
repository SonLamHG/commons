# SCENARIOS — Test-case-as-spec cho dogfood

> Leader: "test cases là spec". Đây là 3 kịch bản đời thật, mỗi cái có **pass/fail rõ ràng**. Chạy tay (chính bạn = agent harness + reviewer), ghi mọi ma sát vào [FINDINGS.md](FINDINGS.md).
>
> Đây KHÔNG phải unit test. Đây là "công việc tri thức thật đi qua commons từ đầu đến cuối".

Vòng lặp chung cho cả 3:
`agent đề xuất change-set (qua MCP)` → `bạn review trên web UI` → `approve / reject-with-reason` → `(nếu là content) publish ra webhook`.

---

## S1 — Viết & duyệt một bài LinkedIn về chính dự án commons

**Người đóng vai:** bạn (vừa là agent, vừa là reviewer).

**Các bước:**
1. Tạo workspace `linkedin-posts` (template blank).
2. Qua Claude Desktop (MCP đã cắm), yêu cầu agent tạo proposal: viết draft `post-commons.md` — 1 bài LinkedIn kể vì sao bạn build commons.
3. Mở web UI → review diff của proposal.
4. **Reject** vòng 1 với lý do cụ thể (vd: "quá nhiều buzzword, cắt còn 1 ý").
5. Yêu cầu agent sửa theo feedback → proposal mới.
6. **Approve** → merge vào main.
7. Tab Files → **Publish** `post-commons.md` ra webhook (Discord trực tiếp để xác nhận, hoặc Make→LinkedIn).

**PASS khi:**
- [ ] Diff hiển thị đúng nội dung agent viết.
- [ ] Reject có kèm được lý do, và agent đọc lại được lý do đó.
- [ ] Sau approve, file nằm trong main; proposal cũ chuyển trạng thái sạch (không 500).
- [ ] Publish thành công → nội dung tới đúng đích; file được đánh dấu "published".

**FAIL nếu:** bất kỳ bước nào phải mở terminal / sửa file tay / đọc log mới hiểu chuyện gì xảy ra.

---

## S2 — Sửa một tài liệu đang tồn tại (không phải tạo mới)

**Lý do:** giá trị thật = governance gate trên thay đổi, không phải tạo file trắng.

**Các bước:**
1. Workspace `content-calendar` (template content-calendar — đã có sẵn nội dung).
2. Agent đề xuất sửa 1 dòng trong calendar (đổi ngày / thêm 1 mục).
3. Review diff — kiểm tra diff chỉ ra **đúng dòng đổi**, không phải cả file.
4. Approve.
5. Lặp lại: cho agent đề xuất **2 proposal chồng nhau** cùng sửa 1 file → approve cái 1 → approve cái 2.

**PASS khi:**
- [ ] Diff của sửa-1-dòng đọc được như diff git bình thường (không phải full-file replace).
- [ ] Proposal thứ 2 hoặc merge sạch, hoặc báo conflict rõ ràng (không âm thầm ghi đè / không corrupt main).

**FAIL nếu:** không phân biệt được "đổi 1 dòng" với "viết lại cả file", hoặc proposal 2 làm hỏng main.

---

## S3 — Người thứ 2 (non-dev) tự review mà không có bạn ngồi cạnh

**Người đóng vai:** chị leader / 1 người không phải dev. Đây là "real user tuần 1".

**Tiền đề:** họ chỉ nhận được **1 URL** + 1 câu hướng dẫn. Không cài gì, không terminal.
> (Nếu chưa deploy được → đây chính là finding blocker đầu tiên, ghi luôn và dừng S3.)

**Các bước:**
1. Bạn (agent) tạo sẵn 1 proposal chờ duyệt trong 1 workspace.
2. Gửi họ URL + đúng 1 câu: "Xem đề xuất này, duyệt hoặc từ chối kèm lý do."
3. Quan sát im lặng — **không gợi ý**. Ghi mọi lần họ ngập ngừng / hỏi / click sai.

**PASS khi:**
- [ ] Họ tự tìm được proposal.
- [ ] Họ hiểu diff đang nói gì (đổi cái gì) mà không cần bạn giải thích.
- [ ] Họ approve hoặc reject-kèm-lý-do thành công.

**FAIL nếu:** họ phải hỏi bạn "giờ bấm đâu / cái này nghĩa là gì" quá 1 lần.

---

## Bảng theo dõi

| Kịch bản | Lần chạy | Kết quả | Findings sinh ra |
|----------|----------|---------|------------------|
| S1       |          |         |                  |
| S2       |          |         |                  |
| S3       |          |         |                  |
