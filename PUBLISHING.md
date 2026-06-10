# PUBLISHING — Nối commons ra kênh thật (Discord, LinkedIn, Facebook)

`commons` không biết gì về từng nền tảng. Khi bạn bấm **Publish** một file đã merge, nó POST một JSON tới **webhook URL** bạn cấu hình cho workspace đó. Phần "đăng lên đâu" là việc của một hub (Make / Discord / Zapier...).

## Payload commons gửi đi

```jsonc
{
  "workspace": "linkedin-posts",
  "path": "items/post-1/post.md",
  "title": "Tiêu đề suy ra từ dòng # đầu tiên",
  "content": "# Tiêu đề\n\nNội dung **markdown thô**...",  // giữ nguyên markdown
  "text": "Tiêu đề\n\nNội dung markdown thô..."             // đã strip #, **, [](), `, bullets→•
}
```

- **`content`** = markdown thô. Dùng cho nơi tự render markdown (hoặc Discord — field `content` trùng tên field Discord cần nên hoạt động trực tiếp).
- **`text`** = bản plain-text. **Dùng cái này khi đăng lên LinkedIn / Facebook** (chúng không render markdown).

> commons CHỈ đánh dấu file là "published" **sau khi** webhook trả về 2xx. Webhook lỗi → trả 502, không đánh dấu.

---

## A. Discord (nhanh nhất, để test)

1. Server Settings → Integrations → Webhooks → **New Webhook** → Copy URL.
2. Dán URL vào ô webhook của workspace trong commons.
3. Publish → tin nhắn hiện trong kênh (Discord đọc field `content`).

---

## B. LinkedIn qua Make (làm thật)

LinkedIn không nhận webhook trực tiếp → cần Make làm cầu nối.

1. Vào [make.com](https://make.com) → **Create a new scenario**.
2. Module 1: **Webhooks → Custom webhook** → **Add** → đặt tên → **Copy address**.
   - Dán address này vào ô webhook của workspace trong commons.
   - Để Make "học" cấu trúc dữ liệu: bấm **Run once** ở Make, rồi qua commons **Publish** 1 lần. Make sẽ bắt được mẫu JSON (thấy các field `title`, `content`, `text`...).
3. Module 2: **LinkedIn → Create a Post** (hoặc *Create a Text Post*).
   - Đăng nhập / authorize tài khoản LinkedIn.
   - Trường **Text / Commentary** → map vào **`text`** (KHÔNG dùng `content`, để tránh lộ `#`/`**`).
4. **Save** scenario và bật **ON** (scheduling: Immediately).
5. Quay lại commons → Publish thật → kiểm tra bài lên LinkedIn.

## C. Facebook qua Make

Giống B, chỉ đổi Module 2 thành **Facebook Pages → Create a Post** (FB cá nhân không cho API đăng; phải là **Page**). Map **Message** ← `text`.

---

## Gỡ lỗi nhanh

| Hiện tượng | Nguyên nhân thường gặp |
|-----------|------------------------|
| commons báo `400 no webhook configured` | Chưa lưu webhook URL cho workspace đó |
| commons báo `502 webhook returned 4xx/5xx` | Make scenario đang OFF, hoặc module LinkedIn lỗi auth |
| Make không thấy field để map | Chưa "Run once" + Publish 1 lần để Make học cấu trúc |
| Bài LinkedIn lộ ký tự `#`, `**` | Đang map `content` thay vì `text` |
| Bài bị cắt | LinkedIn giới hạn ~3000 ký tự; rút ngắn draft |
