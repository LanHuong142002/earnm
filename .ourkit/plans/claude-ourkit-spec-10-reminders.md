# Plan: Assignees are reminded about tasks by push notification (#10)

Spec: `.ourkit/specs/claude-ourkit-spec-10-reminders.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-10-reminders.html` (approved 2026-11-18).

## Approach

Reminders are a new task child resource built exactly like comments: Prisma models, a nested router `/projects/:projectId/tasks/:taskId/reminders` with phone-chosen ids, per-field last-write-wins and the same membership checks; on the phone, a store + queue entity + sync cycle copied from `tasks/comments/`. One pure **occurrence calculator** (`nextOccurrences(rule, tz, from, to)`) lives on the phone, which is the only place occurrences are computed; the API only checks that a one-off time is in the future. The phone schedules local notifications with `expo-notifications` from that calculator after every sync (14 days, nearest 64). There is no server push (user, 2026-11-18): notification content is built on the phone. So the phone has "Nhắc kèm" text for tasks it hasn't opened, the project's reminders list returns, per task, its latest 3 "Nhắc kèm" comments (author name and text).

## Prior Art

- **Local + remote notifications on Expo:** `expo-notifications` (official, SDK 58) — reuse. Covers permission, scheduling with date triggers and tap responses. Local notifications need no EAS project or Apple push key.
- **Repeat rules:** `rrule` exists but is heavy and its timezone handling needs Luxon; our 4 rules are small. Write new: ~80 lines using `Intl.DateTimeFormat` for timezone offsets, fully unit-tested (incl. DST).
- **In-project patterns reused:** comments router and `isInvolved` (`apps/api/src/comments/routes.ts`, `apps/api/src/tasks/involved.ts`), `applyLastWriteWins`, limits as exported constants with `409` codes, mobile `sync/queue.ts`, `tasks/comments/sync.ts`, `syncCycle.ts`, `OfflineNote`, `TaskRejectedNotice`, `SheetFrame`, `DueField`, `AssigneeField`, `Collapsible`.

## Changes

**API (`apps/api`)**
- `prisma/schema.prisma` + one migration: `TaskReminder` (id, taskId → cascade, startAt local date + time string, timezone, repeat enum `once|daily|weekly|monthly`, weekdays int[], endDate nullable, per-field `*EditedAt`, `changedAt`, createdById), `TaskReminderRecipient` (reminderId, userId). Migration timestamp is chosen at Build after checking `main` for newer migrations (lesson).
- `src/reminders/routes.ts`: list/create/patch/delete; limits `MAX_REMINDERS_PER_TASK=5`, `MAX_RECIPIENTS=20`; refuse past one-offs; recipients must be members.
- Member removal (`src/members`) and project delete: drop recipients / rows cascade; add to every delete path (lesson).

**Mobile (`apps/mobile`)**
- `npx expo install expo-notifications`; `app.json` plugin.
- `src/tasks/reminders/`: `types.ts`, `api.ts`, `sync.ts`, `store` wiring, `occurrences.ts` (+ tests), `scheduler.ts` (pure: pick this user's reminders, compute, cap 64, content builder), `notifications.ts` (expo-notifications glue: permission state, schedule/cancel all, tap handler), `formState.ts` (defaults, validation), `labels.ts` (row text "8:00 · Hằng ngày").
- Screens: `RemindersSection.tsx` in task screen under the info card (mockup 1a–1d, 4c, 4d); routes `projects/[id]/tasks/[taskId]/reminders/new.tsx` and `[reminderId].tsx` (mockup 2a–2d); `PermissionSheet.tsx` (mockup 3a). Weekday and repeat controls use highlight only.
- `src/app/_layout.tsx`: notification tap → `router.push` task route (after auth), fallback to project list.
- Sign-out: cancel all scheduled notifications.
- `i18n/vi.json`, `en.json`.

## Risks

- **Sensitive Areas: data, schema, public API.** New tables and endpoints; membership checked on every route; scheduled notifications are cancelled on sign-out so the next account on the phone never sees them.
- **Late delivery of others' changes:** without server push, a reminder someone else adds reaches a recipient only after their app syncs. Shown in the report; remote push is a follow-up.
- **Expo Go:** local notifications work in Expo Go, so no dev build is needed to test.
- **iOS 64-pending cap:** scheduler caps and prioritises nearest.
- **Timezone/DST bugs:** calculator tested with Asia/Ho_Chi_Minh and a DST zone.
- **Parallel #11 migration:** order by merge (lesson); recheck timestamps before Ship.

## Test Strategy

Commands: `ourkit command test` (`npm --prefix apps/api test && npm --prefix apps/mobile test`) and `lint`.
- API tests (real test DB): R1, R3–R8, R11–R13, the embedded "Nhắc kèm" comments for R16, and R30 via `migrate deploy` in global setup. R14, R19 and R20 are checks that nothing server-side was added.
- Unit tests (mobile): occurrence calculator R2, R3, R9, R10; mobile scheduler R18, content R16, form defaults/validation R5, R27, queue merge R28, row view model R24.
- R21: check by reading — no mute setting.
- Test Handoff (an iPhone with Expo Go or a dev build): R15, R17, R18 (fires in airplane mode), R22–R29 screens against the mockup, R25 Settings link, a change by another member arriving after the recipient opens the app.
