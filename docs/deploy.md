# Triển khai production (Render + Neon)

Hướng dẫn cho người chưa từng deploy dự án này. Chỉ một người (không phải agent hay CI) deploy lên production. Thay `<service>` bằng tên service Render (ví dụ `earnm-api`) và `<INTERNAL_SECRET>` bằng giá trị bí mật của bạn. Không commit bí mật vào git.

## 1. Tạo database production trên Neon

1. Tạo một Neon project mới, region **Singapore**, chỉ dùng cho production. Tách riêng khỏi database development và database test.
2. Copy connection string **direct** (không pooled, host không có `-pooler`). Lý do: `prisma migrate deploy` có thể lỗi khi chạy qua pooler.
3. Giữ chuỗi này để dán vào `DATABASE_URL` ở bước 3.

## 2. Tạo INTERNAL_SECRET

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Kết quả dài 64 ký tự hex. `INTERNAL_SECRET` phải có ít nhất 32 ký tự, nếu không server từ chối khởi động.

**Lưu ý:** mã mời vào dự án được băm bằng khóa dẫn xuất từ `INTERNAL_SECRET`. Nếu đổi `INTERNAL_SECRET`, mọi lời mời đang chờ sẽ ngừng hoạt động và chủ dự án phải tạo lại lời mời.

## 3. Tạo service trên Render

Trước khi làm bước này, `render.yaml` phải có trên nhánh `main` (PR thêm nó đã được merge), vì Blueprint đọc từ `main`.

1. Đăng ký tài khoản Render (nên dùng **Sign in with GitHub**) và cho Render quyền đọc repository này khi GitHub hỏi.
2. Trong Render: **New → Blueprint**, chọn repository này, nhánh `main`. Render đọc `render.yaml` ở thư mục gốc (service `earnm-api`, free plan, Singapore, tự deploy khi có commit trên `main`). Đừng tạo thêm service bằng **New → Web Service** cho repo này: sẽ thành hai service, mà free plan chỉ đủ giờ chạy cho một service luôn thức.
3. Khi được hỏi, nhập các biến môi trường rồi bấm **Apply**:
   - `DATABASE_URL`: chuỗi direct từ bước 1
   - `INTERNAL_SECRET`: giá trị từ bước 2
   - `TRUST_PROXY`: `0` (sẽ chỉnh ở bước 6)
   - `INVITE_INSTALL_URL` (không bắt buộc): đường link `https://` để người được mời cài app (ví dụ link TestFlight), hiện trên trang lời mời. Để trống nếu chưa có; giá trị không phải `https://` làm server từ chối khởi động.
   - `INVITE_CODE_KEY` (không bắt buộc): khóa riêng (ít nhất 32 ký tự, không có khoảng trắng) để băm mã mời, tách mã mời khỏi `INTERNAL_SECRET`. Để trống thì dùng `INTERNAL_SECRET`. Đổi `INVITE_CODE_KEY` làm mọi lời mời đang chờ ngừng hoạt động.

   Lưu ý: cho tới khi xong bước 6, mọi người dùng chia sẻ chung IP proxy của Render nên dùng chung giới hạn tốc độ đăng nhập. Đừng mở đăng nhập cho người dùng thật trước khi hoàn tất bước 6. Trang lời mời và giới hạn tham gia dự án cũng tính theo IP, nên cũng dùng chung cho mọi người cho tới khi xong bước 6.
4. Render chỉ hỏi các biến này khi tạo Blueprint lần đầu. Về sau muốn đổi hoặc thêm biến thì vào service, tab **Environment**.

## 4. Kiểm tra deploy đầu tiên

Chờ deploy xong (build, rồi `npm run db:deploy && npm start`), sau đó mở:

```
https://<service>.onrender.com/health
```

Thấy trả về thành công (HTTP 200) là API đã chạy. Free plan ngủ sau một thời gian không có request, request đầu tiên có thể chậm; bước 5 giúp giữ service thức.

## 5. Lập lịch tick bằng cron-job.org

Tạo một job trên cron-job.org:

- URL: `https://<service>.onrender.com/internal/tick`
- Method: `POST`
- Lịch: mỗi 5 phút
- Header: `Authorization: Bearer <INTERNAL_SECRET>`
- Bật thông báo khi job thất bại (failure notifications)

Thành công trả về `200 {"status":"ok"}`. Nếu nhận `401 unauthorized` thì header hoặc secret sai (thiếu `Bearer `, sai giá trị, hoặc secret trên Render khác với secret trong cron-job.org).

## 6. Tìm giá trị TRUST_PROXY

`TRUST_PROXY` là số proxy mà API tin khi đọc IP người dùng từ `X-Forwarded-For`. Giá trị sai gây lỗi:

- Quá thấp (`0`): mọi người dùng chung một IP (IP proxy của Render) nên chung giới hạn tốc độ đăng nhập. Vì vậy chưa mở đăng nhập cho người dùng thật trước khi xong bước này.
- Quá cao: người dùng có thể giả IP.

Cách tìm:

1. Từ điện thoại, dùng mạng di động hoặc Wi-Fi bạn đang kiểm tra, gọi:

   Nhập secret mà không gõ vào dòng lệnh (để nó không nằm trong lịch sử shell), truyền header qua stdin (để nó không hiện trong danh sách tiến trình), rồi xoá biến sau khi dùng:

   ```
   # bash
   read -rs INTERNAL_SECRET && export INTERNAL_SECRET
   printf 'Authorization: Bearer %s\n' "$INTERNAL_SECRET" | curl -H @- https://<service>.onrender.com/internal/ip
   unset INTERNAL_SECRET
   ```

   ```
   # PowerShell
   $s = Read-Host -AsSecureString; $env:INTERNAL_SECRET = [System.Net.NetworkCredential]::new('', $s).Password
   "Authorization: Bearer $env:INTERNAL_SECRET" | curl.exe -H "@-" https://<service>.onrender.com/internal/ip
   Remove-Item Env:INTERNAL_SECRET
   ```

   Kết quả dạng `{"ip":"..."}`. (Không có curl trên điện thoại thì dùng máy tính cùng mạng.)
2. So với IP public của mạng đó (ví dụ tìm "what is my ip").
3. Nếu khác nhau, tăng `TRUST_PROXY` trong Render lên 1, đợi service khởi động lại, gọi lại. Mỗi lần chỉ tăng một.
4. Dừng ngay khi hai IP khớp. Không đặt cao hơn.

## 7. Trỏ ứng dụng mobile tới API

Trong `apps/mobile/.env`:

```
EXPO_PUBLIC_API_URL=https://<service>.onrender.com
```

Dùng HTTPS để mật khẩu và token được mã hóa khi truyền.

Render chỉ chạy `main`. Để test một nhánh khác trên điện thoại, dùng `npm run dev:phone` (xem [test-on-phone.md](test-on-phone.md)), không cần sửa file này.

## 8. Chạy smoke test

Smoke kiểm tra `/health` trả 200, tick không có secret trả 401, tick có secret trả 200.

Nhập secret mà không gõ vào dòng lệnh (để nó không nằm trong lịch sử shell):

```
# bash
read -rs INTERNAL_SECRET && export INTERNAL_SECRET
API_BASE_URL=https://<service>.onrender.com npm --prefix apps/api run smoke
unset INTERNAL_SECRET
```

```
# PowerShell
$s = Read-Host -AsSecureString; $env:INTERNAL_SECRET = [System.Net.NetworkCredential]::new('', $s).Password
$env:API_BASE_URL = "https://<service>.onrender.com"; npm --prefix apps/api run smoke
Remove-Item Env:INTERNAL_SECRET
```

Request đầu tiên có thể mất tới khoảng một phút nếu service đang ngủ (free plan); mỗi kiểm tra chờ tối đa 60 giây. Smoke từ chối gửi secret qua `http://` (trừ localhost), chỉ dùng `https://`.

## 9. Deploy hook (tùy chọn)

1. Trong Render, mở service, **Settings**, copy **Deploy Hook** URL.
2. Đặt vào biến môi trường cục bộ `RENDER_DEPLOY_HOOK_URL`. Không bao giờ commit URL này.
3. Chạy:

   ```
   npm --prefix apps/api run deploy:hook
   ```

## 10. Đổi (rotate) INTERNAL_SECRET

1. Tạo secret mới bằng lệnh ở bước 2.
2. Đổi `INTERNAL_SECRET` trong Render (service khởi động lại).
3. Ngay sau đó đổi header `Authorization` trong cron-job.org sang secret mới. Giữa hai thao tác, tick sẽ trả 401; đó là bình thường.
4. Chạy lại smoke (bước 8).

## 11. Khi migration hoặc khởi động thất bại

Nếu `npm run db:deploy` hoặc `npm start` lỗi, deploy mới bị đánh dấu thất bại và Render giữ nguyên bản code deploy trước đó đang chạy. Xem nguyên nhân tại service trên Render: tab **Events** (trạng thái từng deploy) và tab **Logs** (đầu ra của migration và server). Sửa lỗi, đẩy lên `main` (hoặc dùng deploy hook) để deploy lại.

Lưu ý quan trọng:

- Migration đã áp dụng thì **không được rollback**. Nếu migration chạy xong nhưng server sau đó không lên được, Render vẫn giữ code cũ chạy trên schema MỚI.
- Vì vậy mọi migration phải tương thích ngược với phiên bản code trước đó: thêm trước (cột, bảng mới), còn xóa hoặc đổi tên thì làm ở một lần deploy sau, khi code cũ không còn dùng nữa.
- Migration chạy ở mỗi lần start/restart (lệnh start có `npm run db:deploy`). Nếu Neon không truy cập được lúc đó, service không khởi động được.
