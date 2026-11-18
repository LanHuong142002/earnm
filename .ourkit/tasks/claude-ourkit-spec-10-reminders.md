# Tasks: Assignees are reminded about tasks by push notification

Spec: `.ourkit/specs/claude-ourkit-spec-10-reminders.md`. Plan: `.ourkit/plans/claude-ourkit-spec-10-reminders.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-10-reminders.html`.

**Reminder rule shape shared by all tasks:** `{ startDate: "YYYY-MM-DD", time: "HH:MM", timezone: IANA string, repeat: "once"|"daily"|"weekly"|"monthly", weekdays: number[] (0=Sun..6=Sat; non-empty only and required for weekly), endDate: "YYYY-MM-DD"|null }`. Occurrences are wall-clock `time` in `timezone` on: once → startDate; daily → every day from startDate; weekly → each chosen weekday on or after startDate; monthly → startDate's day of month, or the month's last day if shorter. None after endDate. A done task has none.

**API contract** (base `/projects/:projectId/tasks/:taskId/reminders`, sign-in required, non-members 404 `not_found`):
- Reminder JSON: `{ id, taskId, startDate, time, timezone, repeat, weekdays, endDate, recipientIds: string[], createdById, changedAt }`.
- `GET /projects/:projectId/reminders` → `{ reminders: Reminder[], remindWith: { [taskId]: { author: string|null, text: string }[] } }` — every reminder in the project, plus each such task's latest 3 "Nhắc kèm" comments newest first.
- `POST /` body `{ id: uuid, startDate, time, timezone, repeat, weekdays, endDate, recipientIds }` (strict) → 201, or 200 for the same id on the same task; 409 `id_conflict` on another task; 409 `reminder_limit_reached` at 5; 400 `validation_failed` for: 0 or >20 recipients, non-member recipient, bad weekdays, endDate before startDate, a `once` occurrence not in the future.
- `PATCH /:reminderId` body `{ schedule?: { value: {startDate,time,timezone,repeat,weekdays,endDate}, editedAt }, recipients?: { value: string[], editedAt } }` → 200; last-write-wins per field; same validation (past `once` refused when schedule changes). Any member.
- `DELETE /:reminderId` → 204; any member; 404 if gone.
- `PUT /me/push-token` `{ token }` → 204 (moves the token to the caller); `DELETE /me/push-token` `{ token }` → 204. `GET /projects/:projectId/tasks` with header `X-Push-Token` sets that token's `lastSyncedAt = now()` if it belongs to the caller.
- `changedAt` on a reminder = time of its last create/patch. Content version = max(reminder.changedAt, latest `remindWithEditedAt`/`createdAt` of a "Nhắc kèm" comment on the task).

## Tasks

### 1. Occurrence calculator (both apps)

Write a pure module `occurrences.ts` exporting `occurrencesBetween(rule, from: Date, to: Date): Date[]` (UTC instants) and `isFutureOnce(rule, now)`, using only `Intl.DateTimeFormat` for timezone offsets (no new dependency). Put identical copies at `apps/api/src/reminders/occurrences.ts` and `apps/mobile/src/tasks/reminders/occurrences.ts`, each with the same `occurrences.test.ts`: once, daily, weekly on chosen days, monthly on 31st → last day (Feb, Apr), end date inclusive, Asia/Ho_Chi_Minh and America/New_York across a DST change, empty for a range before start.

Depends on: none
Verify: `ourkit gate run test` passes, including both copies' tests.

### 2. Reminder tables and API

In `apps/api/prisma/schema.prisma` add `TaskReminder` (id String @id, taskId → Task onDelete Cascade, startDate @db.Date, time String, timezone String, repeat enum `ReminderRepeat`, weekdays Int[], endDate @db.Date?, scheduleEditedAt, recipientsEditedAt, changedAt, createdById → User? SetNull, createdAt, `@@index([taskId])`), `TaskReminderRecipient` (reminderId → cascade, userId → User cascade, `@@id([reminderId, userId])`), `DevicePushToken` (token String @id, userId → User cascade, lastSyncedAt DateTime?, createdAt), `ReminderPushSent` (reminderId → cascade, userId → cascade, occurrenceAt DateTime, sentAt, `@@id([reminderId, userId, occurrenceAt])`). Every new NOT NULL column has a default. Create one migration folder with a timestamp later than every folder in `apps/api/prisma/migrations` on `origin/main`.

Add `apps/api/src/reminders/routes.ts` implementing the contract (pattern: `apps/api/src/comments/routes.ts` and `apps/api/src/checklists/routes.ts`: `requireTask`, `lockProject`, `withRetry`, zod strict, `applyLastWriteWins`, editedAt clamped). Export `MAX_REMINDERS_PER_TASK = 5`, `MAX_REMINDER_RECIPIENTS = 20`. Mount the task router and the project-level `GET /projects/:projectId/reminders` in `apps/api/src/app.ts`. When a member is removed from a project (`apps/api/src/members`), delete their `TaskReminderRecipient` rows for that project's reminders in the same transaction. Project delete already cascades through tasks; confirm with a test. Tests in `apps/api/src/reminders/routes.test.ts` for spec AC1, 3, 4, 6, 7, 8, 11, 12, 13, 30 and the `remindWith` embed (latest 3, newest first, only flagged).

Depends on: 1
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 3. Push tokens and tick catch-up

Add `expo-server-sdk` to `apps/api` (npm install, record version). `apps/api/src/push/sender.ts`: interface `PushSender { send(messages: {to, title, body, data}[]): Promise<{ invalidTokens: string[] }> }`, an Expo implementation (chunking, `DeviceNotRegistered` → invalid), and a fake for tests. `apps/api/src/me/` routes `PUT/DELETE /me/push-token`; the tasks list route updates `lastSyncedAt` when `X-Push-Token` matches a caller-owned token. `apps/api/src/push/catchUp.ts`: given `now` and the previous tick time (stored in a small `TickState` row or derived from the latest `ReminderPushSent.sentAt`; capped at 15 minutes back), find occurrences in the window for reminders on not-done tasks (use task 1's calculator), and for each recipient whose tokens all have `lastSyncedAt` null or before the content version, insert `ReminderPushSent` (skip on conflict) and send to all their tokens; content per spec R16 (title = task title; body lines: due date/time and project name, then up to 3 "Name: text"; `data: { projectId, taskId }`); delete invalid tokens. Call it from `POST /internal/tick` in `apps/api/src/internal/routes.ts`; skip when no token exists. Optional `EXPO_ACCESS_TOKEN` in `apps/api/src/config.ts`. Tests (fake sender) for spec AC14, 19, 20.

Depends on: 2
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 4. Phone reminders data layer and scheduler

In `apps/mobile/src/tasks/reminders/`: `types.ts`, `api.ts`, `store.ts` (per-owner cache of the project reminders list and `remindWith` map, pruned with the task cache), `sync.ts` (register a `reminder` entity on `apps/mobile/src/sync/queue.ts`, schedule and recipients as separate fields; refused changes go through the existing task rejected notice), `overlay.ts` (queued create → `waiting`, queued patch → new values, queued delete → hidden), `formState.ts` (defaults per spec R4/R5: assignees or creator; due date at due time, or 9:00 on due date, or 9:00 tomorrow; validation: future one-off, ≥1 recipient, weekdays for weekly, end ≥ start), `labels.ts` (row text: "8:00 · Hằng ngày", "T6, 21 Thg 11 · 15:00 · Một lần", "9:00 · T2, T4, T6", "· đến 21 Thg 11", VI and EN, reusing date helpers in `apps/mobile/src/tasks/dueDate.ts`), `scheduler.ts` (pure: given reminders, tasks, remindWith map, me, now → the notification requests for the next 14 days for reminders where I'm a recipient and the task isn't done, nearest 64, each with a stable identifier `reminderId@iso`, content per spec R16), and `useTaskReminders.ts`. Wire the project reminders fetch into the refresh in `apps/mobile/src/tasks/syncCycle.ts`. Unit tests: `formState.test.ts`, `labels.test.ts`, `scheduler.test.ts`, `overlay.test.ts`, `sync.test.ts` (spec AC5, 10, 16, 18, 24, 27, 28).

Depends on: 1, 2
Verify: `ourkit gate run test` and `ourkit gate run lint` pass.

### 5. Notifications glue on the phone

`npx expo install expo-notifications` in `apps/mobile`; add its plugin to `app.json`. `apps/mobile/src/tasks/reminders/notifications.ts`: foreground handler shows banners; `permissionState()`; `requestPermission()`; `applySchedule(requests)` cancels everything previously scheduled by the app and schedules the given requests with date triggers; `registerPushToken()` only when `Constants.expoConfig?.extra?.eas?.projectId` exists (then `getExpoPushTokenAsync({ projectId })` and `PUT /me/push-token`; store the token for the `X-Push-Token` header in `apps/mobile/src/lib/api.ts`); on sign-out (`apps/mobile/src/auth/AuthProvider.tsx`) unregister the token and cancel all. Run `applySchedule(scheduler(...))` after each successful refresh, on app start and after local reminder changes. Tap handling in `apps/mobile/src/app/_layout.tsx`: on a response (including the one that launched the app), once signed in, `router.push` to `/projects/[id]/tasks/[taskId]`; if that task isn't in the cache after a refresh, go to the project list. Keep the glue thin; logic stays in the tested pure modules.

Depends on: 4
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. Firing on a locked phone, tapping and Expo Go push are a Test Handoff.

### 6. Reminders section, screen and permission sheet

From the mockup (sections 1–4): `RemindersSection.tsx` under the info card in `apps/mobile/src/app/(app)/(home)/projects/[id]/tasks/[taskId]/index.tsx` (N/5, ＋ Thêm or grey "Tối đa 5", rows with bell tile and chevron, "Chờ lưu", empty state, done state greyed with the stopped line, permission-denied `dangerBg` notice with "Mở Cài đặt" via `Linking.openSettings()`). Routes `.../tasks/[taskId]/reminders/new.tsx` and `.../reminders/[reminderId].tsx` with `ReminderForm.tsx`: date and time pickers (reuse the pickers in `apps/mobile/src/tasks/DueField.tsx`), a 4-way segmented repeat control, 7 weekday buttons, Kết thúc pills with a date field, recipient checkboxes with "được giao", field errors, primary Lưu (disabled while invalid), "Xoá lời nhắc" with a confirm alert on edit. Selections use highlight only, no tick marks; checkboxes keep their tick. `PermissionSheet.tsx` (explanation, Tiếp tục / Để sau) shown after the first save when permission is undetermined, using `SheetFrame`. Navigation per the spec's map (push, back pops, Lưu pops). `DESIGN.md` tokens only; `tasks.reminders.*` keys in `vi.json` and `en.json`.

Depends on: 4, 5
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. Looking at it on the phone against the mockup is a Test Handoff.
