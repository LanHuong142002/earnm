# Tasks: Members get push notifications for project activity (#16)

Spec: `.ourkit/specs/claude-ourkit-epic-16-1db117.md` (R1–R35, AC1–AC35). Plan: `.ourkit/plans/claude-ourkit-epic-16-1db117.md`. Mockup: `.ourkit/mockups/claude-ourkit-epic-16-1db117.html` (approved).

Rules for every task:
- Run the API test suite alone. It shares one test database, so never run it in parallel with another task's run.
- No new runtime dependencies.
- Network failures in tests come from `createFakeSender`'s `failing` set, never from a real port.

## Tasks

### 1. Activity schema and migration

In `apps/api/prisma/schema.prisma`, add the tables below, following the plan's "API: data" section. Then add the migration `apps/api/prisma/migrations/<timestamp>_activity/migration.sql`. Its timestamp must sort after `20261120130000_drafts`; use the current time, `20261125...`.

Tables:
- `enum ActivityType { assigned comment done idea member_joined }`
- `enum ActivityPushState { pending sent late muted dropped }`
- `ActivityEvent`
- `ActivityRecipient`, with primary key `(eventId, userId)` and indexes `(userId, occurredAt desc, eventId)` and `(pushState, dueAt)`
- `NotificationTypeMute(userId, type)`
- `ProjectNotificationMute(userId, projectId)`

Foreign keys:
- Project and User cascade.
- Task, idea, actor and member are set to null.

Add `apps/api/src/activity/schema.test.ts`, following `tasks/schema.test.ts`. It checks that the migration applies to an empty database and to one with existing data.

Depends on: none
Verify: `ourkit gate run build`; the new schema test passes in `ourkit gate run test` (AC28).

### 2. Return the applied fields from last-write-wins

Change `applyLastWriteWins` in `apps/api/src/http/last-write-wins.ts` to return `Promise<string[]>`: the names of the fields it actually wrote. Keep every caller compiling and behaving the same. Add a unit test in `http/last-write-wins.test.ts`: a field with an older `editedAt` is not in the returned list, and a newer one is.

Depends on: none
Verify: `ourkit gate run build`; `ourkit gate run test`.

### 3. Extract push delivery from the reminder catch-up

Move the generic part of `apps/api/src/push/catchUp.ts` into a new `apps/api/src/push/deliver.ts`: send the messages through the `PushSender`, delete invalid `DevicePushToken` rows, and report what was delivered for each message. Make `catchUp.ts` call it. Reminder behaviour must not change, so the existing `push/catchUp.test.ts` and `reminders` tests must pass unchanged.

Depends on: none
Verify: `ourkit gate run test`, with the reminder tests unchanged and passing.

### 4. Record activity events in the five write paths

Create:
- `apps/api/src/activity/recipients.ts`, with these helpers:
  - `taskPeople(tx, taskId)`: the creator, the assignees, and distinct earlier comment authors
  - `projectMembers(tx, projectId)`
- `apps/api/src/activity/record.ts`, with `recordActivity(tx, {...})`. It:
  - drops the actor and duplicates from the recipients
  - inserts the `ActivityEvent` and its `ActivityRecipient` rows
  - sets `dueAt` to the recipient's open window if one exists, otherwise to now + 60 s
  - sets `pushState=late` when the event is more than 1 h old
  - returns the earliest `dueAt`

Call it inside the existing transactions:
- `tasks/routes.ts` POST: `assigned` for the assignees, except the actor.
- `tasks/routes.ts` PATCH, using task 2's applied fields and the existing assignee claim:
  - `assigned` for newly added assignees only
  - `done` when `status` was applied and changed from not done to `done`
  - `occurredAt` is the clamped `editedAt`
- `ideas/toTask.ts`: `assigned` for the assignees.
- `comments/routes.ts` create: `comment`.
- `ideas/routes.ts` create: `idea`. A repeat with the same client id records nothing.
- `invites/routes.ts` join: `member_joined` for the existing members.

`subjectTitle` is the task or idea title at that moment. Add `AppDeps.activityScheduler?: { schedule(dueAt: Date): void }` to `app.ts`, and call `schedule` after each commit that recorded rows; with no scheduler, do nothing. Add `apps/api/src/activity/record.test.ts` with tests for AC1–AC11. The "no event" checks look at the rows: no push happens in this task.

Depends on: 1, 2
Verify: `ourkit gate run test` (AC1–AC11 tests); `ourkit gate run build`.

### 5. Push text, flush, scheduler and tick

Create:
- `apps/api/src/push/activityText.ts`: build a project's message in vi or en. The title is the project name. The body is the 3 newest lines, as in the plan's text table, then "+N nữa" or "+N more".
- `apps/api/src/push/activity.ts`, with `flushActivity({prisma, sender, now})`. It runs under advisory lock `1_016_001`, then:
  - selects due `pending` rows, plus failed ones whose retry is due (2 min apart, at most 3 attempts within 1 h)
  - marks rows `dropped` when they are older than 1 h, the recipient is no longer a member, or the task or idea is gone
  - marks rows `muted` when their type or project is muted
  - groups the rest by (user, project), claims them with compare-and-set on `attempts`, sends through task 3's `deliver`, and marks them `sent`
  - sends push `data` of `{kind:"activity", projectId, target, eventIds}`. `target` is `{type:"task",taskId}` when every line is one task, `{type:"idea",ideaId}` when every line is one idea, `{type:"members"}` when every line is a join, and `{type:"project"}` otherwise.
  - returns without error when no sender is set
- `apps/api/src/activity/scheduler.ts`:
  - `createTimerScheduler(flush, now)` keeps one unref'd `setTimeout` for the earliest `dueAt` and re-arms after each flush
  - `createManualScheduler()` is for tests

Wire it up:
- In `index.ts`, wire the timer scheduler into `createApp`.
- In `internal/routes.ts`, make `POST /internal/tick` also call `flushActivity` and delete `ActivityEvent` rows older than 30 days.

Add `apps/api/src/push/activity.test.ts`, using `createClock` and `createFakeSender`, with tests for AC7, AC12–AC16, AC20 and AC22's server half. AC22's server half: reminder pushes still go to a user who has muted everything.

Depends on: 3, 4
Verify: `ourkit gate run test` (those tests, plus the reminder tests unchanged); `ourkit gate run build`.

### 6. Notification settings and feed API

Create `apps/api/src/activity/routes.ts` and mount it in `app.ts`, before the more general routes. The endpoints are in the plan's "API: settings and feed" section:
- `GET /me/notification-settings`
- `PUT /me/notification-settings/types/:type`
- `PUT /projects/:projectId/notification-mute`, which returns 404 when the caller isn't a member
- `GET /me/activity?cursor=`, which:
  - returns 30 rows, newest first
  - uses a keyset cursor on `(occurredAt, eventId)`, encoded as base64url
  - returns only the last 30 days
  - returns only projects the caller is still a member of
  - gives each row: id, type, actor name, subjectTitle, projectId, projectName, taskId, ideaId, memberId, occurredAt, read
- `GET /me/activity/unread`, which returns `{hasUnread}`
- `POST /me/activity/read {eventIds}`, which returns 204 and changes only the caller's rows
- `POST /me/activity/read-all`, which returns 204

Every endpoint uses `requireAuth`. Validate input with zod, so bad input gets `validation_failed`. Add `apps/api/src/activity/routes.test.ts` with tests for AC17, AC21, AC23, AC29, AC31's server half, AC33 and AC35.

Depends on: 1
Verify: `ourkit gate run test`; `ourkit gate run build`.

### 7. Mobile: tap routing for activity pushes

Extend `apps/mobile/src/tasks/reminders/notificationLogic.ts`:
- `TapTarget` gains `idea`, `members` and `project`, parsed from `data.kind === "activity"` and `data.target`.
- `tapDestination` returns:
  - `/projects/[id]/ideas/[ideaId]` for an idea
  - `/projects/[id]/members` for members
  - `/projects/[id]` for a project
  - `/projects` when the target is gone or the user isn't a member

In `NotificationGlue.tsx`, route activity pushes the same way and pass the push's `eventIds` to an `onActivityOpened(eventIds)` callback. Task 8 provides the callback; until then it may be a no-op. Add unit tests for AC24.

Depends on: none
Verify: `ourkit gate run test` (mobile tap tests); `ourkit gate run lint`.

### 8. Mobile: Activity screen, provider and Home bell

Build mockup 2a, 2b and 3a–3e.

Create:
- `apps/mobile/src/activity/api.ts`, added to `lib/api.ts`: the calls to task 6's feed endpoints.
- `apps/mobile/src/activity/ActivityProvider.tsx`, mounted next to the other providers. It:
  - keeps the pages and `hasUnread`
  - caches the first page in AsyncStorage
  - marks rows read optimistically
  - keeps a persisted pending-read set that is flushed when back online and on app focus
  - wires `onActivityOpened` from task 7
- `apps/mobile/src/activity/format.ts`, pure: `groupByDay` (Hôm nay / Hôm qua / Trước đó), `relativeTime` (VI/EN), `rowText`, and `rowTarget`, which reuses task 7's `tapDestination`.
- `apps/mobile/src/app/(app)/(home)/activity.tsx`:
  - icons per type, matching the mockup: a task sheet with an arrow for assigned, chatbubble, checkmark-circle, bulb, and person-add for member joined
  - unread rows in bold with an orange dot, and "Đọc hết" in the header
  - placeholder rows while loading, an empty state with "Về trang chủ", the offline list with the existing offline line, and an error card with "Thử lại"
  - more rows loaded on scroll

Wire it up:
- Register the screen in `(home)/_layout.tsx` with the title "Hoạt động".
- Add the Home header bell as `headerRight` on `index`. It shows an orange dot when `hasUnread`, has the accessible name "Hoạt động" or "Hoạt động, có mục chưa đọc", and pushes `/activity`.
- Add VI and EN keys to `i18n/vi.json` and `i18n/en.json`.

Add unit tests for AC30, AC31's tap mapping, AC32 (the dot and its accessible name) and AC34 (pending reads flushed when back online).

Depends on: 6, 7
Verify: `ourkit gate run test` (mobile tests, including `parity.test.ts`); `ourkit gate run lint`. By hand against mockup 2–3 on a phone: Test Handoff.

### 9. Mobile: notification switches in Account and on the project screen

Build mockup 4a–4c and 5a–5b.

Create `apps/mobile/src/notifications/useNotificationSettings.ts`. It:
- loads `GET /me/notification-settings`
- flips a switch optimistically, calls the PUT, and on failure reverts and shows the existing `ErrorText` with "Không lưu được. Đã trả lại như cũ."

Add the screens:
- In `app/(app)/account.tsx`, a "Thông báo" section between Ngôn ngữ and Giao diện. It has 5 React Native `Switch` rows (Được giao việc, Bình luận mới, Việc đã hoàn thành, Ý tưởng mới, Thành viên mới), each with an accessible name, and the caption about reminders and the feed. While loading, show a placeholder block.
- In `app/(app)/(home)/projects/[id]/index.tsx`, a "Thông báo hoạt động" row under Thành viên and above Chi tiết. It has a switch, and its caption changes when muted, as in mockup 5b.
- VI and EN keys.

Add unit tests for AC27, where a failed save reverts the switch.

Depends on: 6
Verify: `ourkit gate run test`; `ourkit gate run lint`. By hand against mockup 4–5: Test Handoff.
