# Project Log

| Date | Name | Tier | Summary | Link |
|---|---|---|---|---|
| 2026-11-10 | People can create an account and sign in on iPhone | feature | Email/password auth with hashed opaque sessions and layered sign-in limits, first Prisma schema, iPhone sign-in/settings screens with VI/EN and DESIGN.md. | https://github.com/LanHuong142002/earnm/pull/19 |
| 2026-11-10 | The API runs on Render and stays awake | feature | Render Blueprint with migrate-on-start, secret-protected /internal/tick and /internal/ip with a constant-time check, required INTERNAL_SECRET, smoke and deploy commands, and a Vietnamese deploy guide. | https://github.com/LanHuong142002/earnm/pull/20 |
| 2026-11-11 | Projects with offline sync (#4) | feature | Projects API with per-field last-write-wins and a shared offline write queue (#25), then connected screens with Home, tabs and the user's reference look. | https://github.com/LanHuong142002/earnm/pull/26 |
| 2026-11-12 | Owners can invite people with a single-use link (#5) | feature | Single-use HMAC-stored invite codes with an API-served invite page, member list and role changes under a project row lock, and phone avatar row, Members, Join and profile screens. | https://github.com/LanHuong142002/earnm/pull/29 |
| 2026-11-12 | #6 Tasks | feature | Tasks in a project with status, assignees, due date, filters and offline sync on the shared queue; reuses #5's members. | https://github.com/LanHuong142002/earnm/pull/30 |
