# earnm

- `apps/api`: API (Express 5 + Prisma 7).
- `apps/mobile`: app Expo (React Native).

## Test trên điện thoại

Chạy API của checkout hiện tại cùng Expo, app trỏ tới API đó (không sửa `.env`, không đổi nhánh):

```
npm run dev:phone
```

Chi tiết, tùy chọn, worktree mới, tường lửa và tunnel: [docs/test-on-phone.md](docs/test-on-phone.md).

## Deploy

[docs/deploy.md](docs/deploy.md).
