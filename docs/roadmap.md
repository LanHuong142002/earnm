# earnm roadmap

App giúp nhóm bạn lên kế hoạch kinh doanh (ví dụ mở quán nước): món, giá cost, ý tưởng, nhắc việc, phân công, dòng tiền. Một người có thể sở hữu nhiều project và được mời vào project của người khác.

Ghi lại từ buổi Init ngày 2026-11-09. Mỗi mục sẽ đi qua lifecycle của ourkit (Spec → Plan → …) khi bắt đầu làm.

## Yêu cầu chung

- Chạy trên iPhone qua Expo Go (chưa lên App Store).
- Song ngữ EN / VI; tiền tệ VND và USD.
- Dùng được khi mất mạng: xem dữ liệu và ghi tạm offline, tự đồng bộ khi có mạng. Xử lý xung đột khi nhiều người sửa offline để sau.
- Chỉ dùng hosting free tier.

## MVP

1. **Lịch nhắc và công việc**
   - Task có người được giao, hạn, trạng thái, comment.
   - Nhắc một lần và nhắc lặp lại, có push notification.
   - Khi nhắc thì kèm các comment được đánh dấu "nhắc kèm".
   - Hướng kỹ thuật dự kiến: local notification trên máy để nhắc đúng giờ, server push khi có thay đổi.
2. **Ý tưởng**: bảng ý tưởng cho mỗi project.
3. **Tính giá cost**
   - Nhập giá mua nguyên liệu và định lượng từng món, app tự tính cost mỗi ly.
   - Chỉ lưu một vài giá gần nhất, không lưu toàn bộ lịch sử.

## Sau MVP

- Gợi ý giá bán theo % lợi nhuận mong muốn.
- Ghi vốn góp của từng người và chia lời theo tỉ lệ.
- Thu chi theo nhóm, báo cáo theo tháng.
- Máy tính hoà vốn.
- Vote và comment cho ý tưởng.
- Danh bạ nhà cung cấp.
- Thành viên và phân quyền (Owner / Member / Viewer?), mời bằng link hoặc email.

## Upcoming (giai đoạn sau)

- **Quản lý tồn kho**: nhập hàng, trừ kho, cảnh báo sắp hết.
- **Nhận chuyển khoản tự động**: bấm QR trong app, chuyển khoản qua ngân hàng, quay lại app thấy số tiền đã nhận. Hướng dự kiến: VietQR + webhook từ dịch vụ như SePay/Casso, cần tìm hiểu kỹ khi làm.

## Hạ tầng

- Backend: Express trên Render free, chỉ một service vì free tier giới hạn 750 giờ/tháng.
- Database: PostgreSQL trên Neon free.
- Giữ server thức: cron-job.org gọi endpoint có secret, ví dụ `POST /internal/tick`, khoảng mỗi 5 phút. Endpoint này cũng làm lưới an toàn cho nhắc việc.
