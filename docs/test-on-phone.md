# Test một nhánh trên iPhone (Expo Go) bằng một lệnh

Render (`https://earnm-api.onrender.com`) chỉ chạy nhánh `main`. Muốn test tính năng đang nằm trên một nhánh khác (ví dụ route mới), app phải gọi API **của chính checkout đó**, chạy trên máy tính. Script `scripts/dev-phone.mjs` làm việc này, không sửa file nào và không cần đổi nhánh.

## Lệnh

Từ thư mục gốc của checkout hoặc worktree đang muốn test (PowerShell, cmd hay Git Bash đều được):

```
npm run dev:phone
```

Script sẽ:

1. Chạy `npm ci` trong `apps/api` và `apps/mobile` nếu chưa có `node_modules` (lần đầu ở checkout đó).
2. Chạy API của checkout này (`npm --prefix apps/api run dev`) ở cổng `PORT` (lấy từ biến môi trường, rồi `apps/api/.env`, mặc định `3000`), chờ tới khi `/health` trả lời.
3. Tìm IP LAN IPv4 của máy (ưu tiên Wi-Fi/Ethernet, bỏ qua Tailscale, WSL, Hyper-V, VPN...).
4. Chạy `npx expo start` trong `apps/mobile` với `EXPO_PUBLIC_API_URL=http://<ip-lan>:<cổng>` **chỉ cho lần chạy này**. `apps/mobile/.env` giữ nguyên.
5. In ra nhánh, checkout, API URL và mã QR của Expo.

Trên iPhone: mở app **Camera**, quét mã QR, chọn mở bằng Expo Go. Lần đầu Expo Go hỏi quyền **Local Network**, chọn Allow. Để chắc điện thoại gọi được API, mở `http://<ip-lan>:<cổng>/health` bằng Safari trên iPhone (script in sẵn địa chỉ này).

Dừng: `Ctrl+C`, script tắt cả API lẫn Expo.

### Tùy chọn

| Lệnh | Khi nào dùng |
|---|---|
| `npm run dev:phone -- --ip 192.168.1.20` | IP tự tìm sai (máy có nhiều mạng). Script in các IP khác nó thấy. |
| `npm run dev:phone -- --port 3001` | Cổng 3000 đang bận, ví dụ API của worktree khác đang chạy. Script báo lỗi nếu cổng đã có người dùng. |
| `npm run dev:phone -- --render` | Không chạy API local, dùng Render (code của `main`). |
| `npm run dev:phone -- --api-url https://...` | Không chạy API local, dùng một URL bất kỳ. |
| `npm run dev:phone -- --tunnel` | Truyền `--tunnel` cho Expo (xem phần khác Wi-Fi bên dưới). |
| `npm run dev:phone -- --clear` | Xóa cache Metro. Script tự xóa một lần khi API URL khác lần chạy trước, vì giá trị `EXPO_PUBLIC_*` được nhúng sẵn vào bundle. |
| `npm run dev:phone -- --copy-env` | Copy các file `.env` còn thiếu từ checkout chính (xem dưới). |

Dấu `--` đầu tiên là của npm. Muốn truyền thêm tham số thẳng cho Expo, thêm một `--` nữa: `npm run dev:phone -- -- --port 8082`.

## Worktree mới: copy file `.env`

`apps/api/.env` và `apps/mobile/.env` bị gitignore, nên một worktree mới không có chúng. Mỗi checkout dùng file `.env` của riêng nó.

- Cách nhanh: `npm run dev:phone -- --copy-env` copy `apps/api/.env` (và `apps/mobile/.env` nếu có) từ checkout chính (worktree đầu tiên trong `git worktree list`). Script không in giá trị nào.
- Hoặc copy tay, từ thư mục gốc của worktree mới (thay `C:\D\anmay` bằng đường dẫn checkout chính):

  ```powershell
  Copy-Item C:\D\anmay\apps\api\.env apps\api\.env
  Copy-Item C:\D\anmay\apps\mobile\.env apps\mobile\.env
  ```

  ```bash
  cp /c/D/anmay/apps/api/.env apps/api/.env
  cp /c/D/anmay/apps/mobile/.env apps/mobile/.env
  ```

`apps/api/.env` cần `DATABASE_URL`, `TEST_DATABASE_URL` và `INTERNAL_SECRET` (32+ ký tự), xem `apps/api/.env.example`. `apps/mobile/.env` không bắt buộc cho script này (script tự đặt `EXPO_PUBLIC_API_URL`), nhưng vẫn cần nếu chạy `npx expo start` trực tiếp.

Lưu ý: các worktree dùng chung database development trong `DATABASE_URL`. Nếu một nhánh có migration mới, chạy `npm --prefix apps/api run db:migrate` trước khi test, và nhớ rằng các nhánh khác cũng thấy schema đã đổi.

## Điện thoại và máy tính phải cùng Wi-Fi

Điện thoại gọi API qua IP LAN của máy tính, nên cả hai phải ở cùng mạng Wi-Fi (không phải Wi-Fi khách, mạng có "client isolation" cũng chặn).

### Tường lửa Windows

Lần đầu chạy, Windows có thể hỏi có cho Node.js nhận kết nối không: chọn cho phép trên **Private network**, và đặt mạng Wi-Fi ở chế độ Private (Settings → Network & internet → Wi-Fi → mạng đang dùng → Private network). Nếu Safari trên iPhone không mở được `/health`, mở cổng 3000 (và 8081 cho Metro) bằng PowerShell chạy **as Administrator**:

```powershell
New-NetFirewallRule -DisplayName "earnm dev (API 3000, Metro 8081)" -Direction Inbound -Protocol TCP -LocalPort 3000,8081 -Action Allow -Profile Private
```

### Khi không cùng Wi-Fi

`npx expo start --tunnel` (hay `npm run dev:phone -- --tunnel`) đưa **Metro** qua một tunnel để điện thoại tải được app từ mạng khác. Tunnel không phủ API local, nên khi đó điện thoại vẫn không gọi được `http://<ip-lan>:3000`. Hai cách:

- Test với API trên Render: `npm run dev:phone -- --render --tunnel` (chỉ có code của `main`).
- Hoặc tự mở một tunnel cho cổng API (ví dụ Cloudflare Tunnel, ngrok) rồi truyền URL đó: `npm run dev:phone -- --api-url https://<tunnel-url> --tunnel`.

## Lỗi `npx expo login` trên Windows

`npx expo login` bị crash khi mở trình duyệt vì URL đăng nhập có ký tự `&`. Hai cách tránh:

- Không cần đăng nhập CLI: quét mã QR bằng app Camera của iPhone là đủ để mở app trong Expo Go.
- Nếu cần đăng nhập, chạy từ `apps/mobile` và không mở trình duyệt:

  ```
  npx expo login --username <tên-tài-khoản> --no-browser
  ```
