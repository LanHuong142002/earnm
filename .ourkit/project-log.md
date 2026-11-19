# Project Log

| Date | Name | Tier | Summary | Link |
|---|---|---|---|---|
| 2026-11-10 | People can create an account and sign in on iPhone | feature | Email/password auth with hashed opaque sessions and layered sign-in limits, first Prisma schema, iPhone sign-in/settings screens with VI/EN and DESIGN.md. | https://github.com/LanHuong142002/earnm/pull/19 |
| 2026-11-10 | The API runs on Render and stays awake | feature | Render Blueprint with migrate-on-start, secret-protected /internal/tick and /internal/ip with a constant-time check, required INTERNAL_SECRET, smoke and deploy commands, and a Vietnamese deploy guide. | https://github.com/LanHuong142002/earnm/pull/20 |
| 2026-11-11 | Projects with offline sync (#4) | feature | Projects API with per-field last-write-wins and a shared offline write queue (#25), then connected screens with Home, tabs and the user's reference look. | https://github.com/LanHuong142002/earnm/pull/26 |
| 2026-11-12 | Owners can invite people with a single-use link (#5) | feature | Single-use HMAC-stored invite codes with an API-served invite page, member list and role changes under a project row lock, and phone avatar row, Members, Join and profile screens. | https://github.com/LanHuong142002/earnm/pull/29 |
| 2026-11-12 | #6 Tasks | feature | Tasks in a project with status, assignees, due date, filters and offline sync on the shared queue; reuses #5's members. | https://github.com/LanHuong142002/earnm/pull/30 |
| 2026-11-17 | #7 checklists and colour labels | feature | Tasks get named checklists with x/y progress and project colour labels with a label filter; Settings gets an Appearance choice. | https://github.com/LanHuong142002/earnm/pull/37 |
| 2026-11-17 | Comments on tasks (#8) | feature | Members comment on tasks in bubbles, 5 at a time, with a remind-with bell for involved people; works offline. | https://github.com/LanHuong142002/earnm/pull/40 |
| 2026-11-18 | Photos on tasks (#9) | feature | Involved people attach up to 10 photos with captions to a task, uploaded to Cloudinary through server signatures and queued offline. | https://github.com/LanHuong142002/earnm/pull/41 |
| 2026-11-18 | Task reminders (#10) | feature | Up to 5 one-off or repeating reminders per task as local notifications, plus Expo push from the tick for phones that haven't synced | https://github.com/LanHuong142002/earnm/pull/46 |
| 2026-11-18 | Ideas board (#11) | feature | Ideas with votes, comments, photos and statuses; an accepted idea becomes a task with assignees and due date | https://github.com/LanHuong142002/earnm/pull/45 |
| 2026-11-19 | #12 ingredients | feature | Ingredients with unit cost per 1/10, total, default flag, 5-price history; currency locked once money exists | https://github.com/LanHuong142002/earnm/pull/48 |
| 2026-11-19 | #13 products | feature | Products with S/M/L recipes, extra costs, selling price, profit, margin and price hint; ingredient-in-use block | https://github.com/LanHuong142002/earnm/pull/49 |
