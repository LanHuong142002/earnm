# Plan: Assignees are reminded about tasks by push notification (#10)

Spec: `.ourkit/specs/claude-ourkit-spec-10-reminders.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-10-reminders.html` (approved 2026-11-18).

## Approach

Reminders are a new task child resource built exactly like comments: Prisma models, a nested router `/projects/:projectId/tasks/:taskId/reminders` with phone-chosen ids, per-field last-write-wins and the same membership checks; on the phone, a store + queue entity + sync cycle copied from `tasks/comments/`. One pure **occurrence calculator** (`nextOccurrences(rule, tz, from, to)`) is written once and copied into both apps with identical tests, because the API and the mobile app share no package today. The phone schedules local notifications with `expo-notifications` from that calculator after every sync (14 days, nearest 64). The API gets a small push module around `expo-server-sdk`, called on reminder and "Nhắc kèm" changes (wake-up push) and from `/internal/tick` (missed-occurrence catch-up). Remote push is switched off when no EAS project id / Expo token is configured, so the feature works with local notifications alone until the user sets up the service.

## Prior Art

- **Local + remote notifications on Expo:** `expo-notifications` (official, SDK 58) — reuse. Covers permission, scheduling with date triggers, push token (`getExpoPushTokenAsync`, needs EAS projectId), tap responses.
- **Sending push from Node:** `expo-server-sdk` (official) — reuse for chunking, receipts and `DeviceNotRegistered` handling instead of hand-written HTTP.
- **Repeat rules:** `rrule` exists but is heavy and its timezone handling needs Luxon; our 4 rules are small. Write new: ~80 lines using `Intl.DateTimeFormat` for timezone offsets, fully unit-tested (incl. DST).
- **In-project patterns reused:** comments router and `isInvolved` (`apps/api/src/comments/routes.ts`, `apps/api/src/tasks/involved.ts`), `applyLastWriteWins`, limits as exported constants with `409` codes, mobile `sync/queue.ts`, `tasks/comments/sync.ts`, `syncCycle.ts`, `OfflineNote`, `TaskRejectedNotice`, `SheetFrame`, `DueField`, `AssigneeField`, `Collapsible`.

## Changes

**API (`apps/api`)**
- `prisma/schema.prisma` + one migration: `TaskReminder` (id, taskId → cascade, startAt local date + time string, timezone, repeat enum `once|daily|weekly|monthly`, weekdays int[], endDate nullable, per-field `*EditedAt`, `changedAt`, createdById), `TaskReminderRecipient` (reminderId, userId), `DevicePushToken` (token unique, userId, lastSyncedAt), `ReminderPushSent` (reminderId, userId, occurrenceAt, unique together). Migration timestamp is chosen at Build after checking `main` for newer migrations (lesson).
- `src/reminders/routes.ts`: list/create/patch/delete; limits `MAX_REMINDERS_PER_TASK=5`, `MAX_RECIPIENTS=20`; refuse past one-offs; recipients must be members.
- `src/reminders/occurrences.ts` (+ test): the calculator.
- `src/push/` : `sender.ts` interface + Expo implementation + fake for tests; `wake.ts` (send to recipients' tokens), `catchUp.ts` (tick window, insert into `ReminderPushSent` first to avoid duplicates, delete invalid tokens).
- `src/me/` : `PUT /me/push-token`, `DELETE /me/push-token`; a successful task list fetch updates `lastSyncedAt` for the caller's token (sent as a header `X-Push-Token`).
- `src/comments/routes.ts`: after a "Nhắc kèm" create/edit/flag change, call `wake` for the task's reminder recipients.
- Member removal (`src/members`) and project delete: drop recipients / rows cascade; add to every delete path (lesson).
- `src/internal/routes.ts`: tick calls `catchUp`.
- `src/config.ts`: optional `EXPO_ACCESS_TOKEN`, `PUSH_ENABLED`.

**Mobile (`apps/mobile`)**
- `npx expo install expo-notifications`; `app.json` plugin; `extra.eas.projectId` read when present.
- `src/tasks/reminders/`: `types.ts`, `api.ts`, `sync.ts`, `store` wiring, `occurrences.ts` (copy + same tests), `scheduler.ts` (pure: pick this user's reminders, compute, cap 64, content builder), `notifications.ts` (expo-notifications glue: permission state, schedule/cancel all, token register, tap handler), `formState.ts` (defaults, validation), `labels.ts` (row text "8:00 · Hằng ngày").
- Screens: `RemindersSection.tsx` in task screen under the info card (mockup 1a–1d, 4c, 4d); routes `projects/[id]/tasks/[taskId]/reminders/new.tsx` and `[reminderId].tsx` (mockup 2a–2d); `PermissionSheet.tsx` (mockup 3a). Weekday and repeat controls use highlight only.
- `src/app/_layout.tsx`: notification tap → `router.push` task route (after auth), fallback to project list.
- Sign-out: unregister token, cancel all scheduled.
- `i18n/vi.json`, `en.json`.

## Risks

- **Sensitive Areas: data, schema, public API.** New tables and endpoints; membership checked on every route; tokens are personal data — never returned to other users, deleted on sign-out and when invalid.
- **Remote push needs the user's service setup** (EAS project, APNs key). Without it, local reminders still work; wake-ups and catch-ups are off. Recorded as a service need.
- **Expo Go limits:** local notifications work in Expo Go, remote push needs a dev build. Hand-testing remote push is a Test Handoff.
- **Duplicate notifications** (local + catch-up): catch-up only targets users with no device synced after the reminder changed; `ReminderPushSent` makes each occurrence once.
- **iOS 64-pending cap:** scheduler caps and prioritises nearest.
- **Timezone/DST bugs:** calculator tested with Asia/Ho_Chi_Minh and a DST zone.
- **Parallel #11 migration:** order by merge (lesson); recheck timestamps before Ship.

## Test Strategy

Commands: `ourkit command test` (`npm --prefix apps/api test && npm --prefix apps/mobile test`) and `lint`.
- API tests (real test DB, push sender faked): R1, R3–R8, R11–R14, R19, R20, R30 via `migrate deploy` in global setup.
- Unit tests (both apps): occurrence calculator R2, R3, R9, R10; mobile scheduler R18, content R16, form defaults/validation R5, R27, queue merge R28, row view model R24.
- R21: check by reading — no mute setting.
- Test Handoff (needs an iPhone dev build and, for remote push, the EAS setup): R15, R17, R18 (fires in airplane mode), R22–R29 screens against the mockup, R25 Settings link, remote wake-up and catch-up end-to-end.
- Network failures for the push sender are tested only through the injected fake (decided now, so Review doesn't flip it).
