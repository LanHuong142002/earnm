# #7: thử tay trên điện thoại

Chuẩn bị: trong thư mục `C:\D\anmay\.claude\worktrees\sync-main-update-ourkit-843790`, chạy `npm run dev:phone`, quét QR bằng Expo Go. Database dev đã có migration mới. Cần 2 tài khoản trong cùng một dự án: một **Chủ dự án (Owner)** và một **Thành viên (Member)**.

Mỗi mục ghi lại **Đạt** hoặc **Không đạt + mô tả ngắn**.

## 13. Xem offline
1. Mở một công việc có checklist và nhãn.
2. Bật chế độ máy bay, tắt hẳn app rồi mở lại.
- Mong đợi: thẻ công việc và màn Công việc vẫn hiện checklist và nhãn, có dòng "Đang ngoại tuyến".

## 14. Thay đổi offline rồi kết nối lại
1. Bật chế độ máy bay.
2. Tạo nhãn mới, gắn nó vào một công việc, thêm một checklist và tick một mục.
3. Tắt chế độ máy bay, đợi vài giây.
- Mong đợi: trên máy thứ hai (hoặc sau khi kéo làm mới), nhãn, checklist và mục đã tick đều có. Không hiện "Không lưu được".

## 16. Thẻ công việc
1. Xem thẻ có 0, 1, 3 và từ 4 nhãn trở lên; xem công việc có và không có mục checklist.
- Mong đợi: tối đa 3 chip nhãn rồi `+n`; `x/y mục` chỉ hiện khi công việc có mục.

## 17. Checklist trên màn Công việc
1. Chạm ô vuông một lần để tick, chạm lần nữa để bỏ tick.
2. "＋ Thêm mục": gõ rồi Return vài lần liên tiếp.
3. ⋯ → Đổi tên checklist; ⋯ → Xóa checklist.
- Mong đợi: hai số tiến độ (của checklist và tổng) đổi ngay; bàn phím vẫn mở khi thêm liên tiếp; hộp xác nhận xoá nêu tên checklist.

## 18. Gắn nhãn
1. Ở màn Công việc, chạm "Sửa"/"Thêm" cạnh Nhãn; chạm để gắn và bỏ nhãn.
2. Chọn "＋ Nhãn mới", đặt tên và màu, tạo.
- Mong đợi: gắn/bỏ có hiệu lực ngay; nhãn mới được tạo và gắn luôn vào công việc. Sheet vuốt xuống thì đóng.

## 19. Màn Nhãn: Member và Owner
1. Bằng tài khoản Member: Quản lý nhãn → thử tạo, đổi tên, đổi màu.
2. Bằng tài khoản Owner: mở một nhãn → Xóa nhãn.
- Mong đợi: Member không thấy nút xoá; Owner thấy hộp xác nhận nêu tên nhãn và nói nhãn bị gỡ khỏi mọi công việc; sau khi xoá, nhãn biến mất khỏi các công việc.

## 20. Lọc theo nhãn
1. Ở danh sách công việc, hàng "Nhãn" → chọn một hoặc hai nhãn.
2. Tắt hẳn app rồi mở lại.
3. Chạm "Bỏ bộ lọc" (khi không còn công việc phù hợp) hoặc bỏ chọn hết.
- Mong đợi: lọc vẫn còn sau khi mở lại; bỏ bộ lọc thì xoá cả lọc nhãn.

## 21. Màu nhãn
1. Mở "Nhãn mới", xem 8 ô màu ở chế độ sáng và tối.
- Mong đợi: đọc rõ tên trên mọi màu; không màu nào giống màu cam chính của app.

## 22. Ngôn ngữ và giao diện
1. Đổi giữa Tiếng Việt và English, đi qua mọi màn mới.
- Mong đợi: không còn chữ chưa dịch; màn hình giống mockup đã duyệt và DESIGN.md.

## 24. Giao diện (theme) và header
1. Cài đặt → Giao diện → chọn Tối khi điện thoại đang sáng; rồi Sáng; rồi Theo hệ thống.
2. Tắt app mở lại; đăng xuất rồi đăng nhập lại.
3. Mở một công việc.
- Mong đợi: mọi màn, header, sheet, hộp thoại đổi theo ngay, có animation; lựa chọn còn sau khi mở lại và sau khi đăng xuất; "Sửa" nằm trên header, "＋ Thêm" cạnh tiêu đề Checklist, không cần cuộn.
