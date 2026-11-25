# Plan: Members get push notifications for project activity (#16)

Spec: `.ourkit/specs/claude-ourkit-epic-16-1db117.md` (R1–R35). Mockup: `.ourkit/mockups/claude-ourkit-epic-16-1db117.html`, approved by the user on 2026-11-25.

## Approach

Each of the five events writes one `ActivityEvent` row and one `ActivityRecipient` row per recipient, in the same transaction as the change (R11). The recipient row is the single record behind three things: the push queue, the feed, and read state. That gives one source of truth instead of three tables that can drift apart.

**Batching window.** Each recipient row stores a `dueAt`:
- If the recipient already has an unsent row whose window is still open, the new row gets that same `dueAt`.
- Otherwise `dueAt` is now + 60 s (R12).

**Sending.** One function, `flushActivity`, sends everything that is due.
- It runs under its own Postgres advisory lock.
- It drops rows whose recipient is no longer a member, whose task or idea is gone, that are muted, or that are older than 1 hour (R7, R14, R20).
- It groups the rest by recipient and project into one message each (R13), sends them through the existing `PushSender`, then settles the rows.

**What calls the flush.** An in-process scheduler arms one `setTimeout` for the earliest `dueAt` after each commit that adds rows, and the existing `POST /internal/tick` also calls the flush (R14). The server only sleeps after 15 idle minutes, and a request always wakes it, so the 1-minute timer survives normal use. The tick covers restarts.

**Mutes** live in two small tables. **The feed** is a cursor-paged read of the caller's own recipient rows. On the phone, the mock-up is built with the existing patterns: a Context provider with an AsyncStorage cache, React Native `Switch`, and `headerRight`.

## Prior Art

- **`apps/api/src/push/catchUp.ts`** (reminder pushes) has the patterns this needs: the advisory lock (L68-70), compare-and-set retry claims, 3 attempts within 60 minutes, and deleting invalid tokens.
  - **Reuse:** extract the generic send → delete invalid tokens → report what was delivered part into `push/deliver.ts`, and call it from both `catchUp.ts` and the new flush.
  - **Write new:** the claim keys and claim SQL. They are reminder-specific, so activity gets its own claim on `ActivityRecipient`, using the same compare-and-set on `attempts`.
  - The existing reminder tests guard the extraction.
- **`push/sender.ts`:** reuse `PushSender`, `createExpoSender` and `createFakeSender` (with its `invalid` and `failing` sets) unchanged.
- **`AppDeps` in `app.ts:34-49`** already injects `now` and `pushSender`. Add an injectable `activityScheduler`: the real one uses `setTimeout`, and tests use a manual one, so the 1-minute window can be tested with `createClock`.
- **`http/last-write-wins.ts`:** `applyLastWriteWins` returns `void` today. Change it to return the names of the fields it applied. Existing callers ignore the return value, so this is safe, and it is the cheapest way to know whether `status` really changed (R8).
- **Assignees** already use a claim on `assigneesEditedAt` (`tasks/routes.ts:320-346`). Reuse that result, plus the old assignee set, to find who was newly added.
- **Membership checks:** reuse `projects/access.ts` (`findForMember`, `lockProject`), `requireAuth`, and `AppError` with the `{error:{code,message}}` shape.
- **Day labels:** `tasks/reminders/labels.ts` `dayLabel` is reused for "Hôm nay / Hôm qua". There is no relative-time helper ("5 phút trước"), so a small pure one is written new with `Intl.RelativeTimeFormat`, which Hermes supports.
- **No cursor pagination** exists anywhere yet, so a keyset cursor on `(occurredAt, eventId)` is written new.
- **Phone taps:** extend `tasks/reminders/notificationLogic.ts`, whose `TapTarget` union covers tasks only, and route through `NotificationGlue.tsx`. No new notification library.
- **Offline mark-read:** not added to `sync/queue.ts`. That queue is built around entity create, update and delete, and an earlier lesson says folding odd changes into it caused blocking findings. A tiny AsyncStorage-backed set of pending read ids, flushed when back online, is enough, because marking read is idempotent.

## Changes

**API: data (`apps/api/prisma/schema.prisma` + migration `2026112513xxxx_activity`)**
- Add `enum ActivityType { assigned comment done idea member_joined }`.
- Add `ActivityEvent`:
  - `id` (uuid), `projectId` (FK, cascade), `type`, `actorId` (FK User, set null)
  - `taskId?` (FK, set null), `ideaId?` (FK, set null), `memberId?` (FK User, set null)
  - `subjectTitle` (a snapshot of the task or idea title, so a deleted target still reads), `occurredAt`, `createdAt`
  - index `(projectId)`
- Add `ActivityRecipient`:
  - `eventId` + `userId` as primary key, both cascade
  - `occurredAt` (copied, for paging), `readAt?`
  - `pushState` enum `pending | sent | late | muted | dropped`
  - `dueAt?`, `attempts`, `lastAttemptAt?`, `sentAt?`
  - indexes `(userId, occurredAt desc, eventId)` and `(pushState, dueAt)`
- Add `NotificationTypeMute(userId, type)`, primary key on both, cascade on user.
- Add `ProjectNotificationMute(userId, projectId)`, primary key on both, cascade on user and project.
- A schema test following `tasks/schema.test.ts`: the migration applies to an empty database and to one with data (R28).

**API: event recording (`apps/api/src/activity/record.ts`, new)**
- `recordActivity(tx, {type, projectId, actorId, taskId?, ideaId?, memberId?, subjectTitle, occurredAt, recipients, now})`:
  - drops the actor and duplicates from the recipients (R6)
  - inserts the event and recipient rows, and computes `dueAt` per recipient (R12)
  - sets `pushState = late` when `now - occurredAt > 1h` (R9)
  - returns the earliest `dueAt`, so the route can arm the scheduler after commit
- Recipient helpers in `activity/recipients.ts`:
  - `taskPeople` = creator + assignees + distinct earlier comment authors (R2, R3)
  - `projectMembers` (R4, R5)
- Call sites, each inside the existing transaction:
  - `tasks/routes.ts` POST: `assigned` for every assignee except the creator.
  - `tasks/routes.ts` PATCH: `assigned` for newly added assignees only, when the assignee claim applied. `done` when `status` applied, moved to `done`, and was not `done` before. `occurredAt` is the field's clamped `editedAt` (R1, R3, R8, R9).
  - `ideas/toTask.ts`: `assigned` for the assignees (R1).
  - `comments/routes.ts` create: `comment`. Comments with "Nhắc kèm" behave the same (R2).
  - `ideas/routes.ts` create: `idea`. Repeating a create with the same client id records nothing (R4, R8).
  - `invites/routes.ts` join: `member_joined` for the existing members (R5).
- Votes, labels, checklists, other fields, role changes and leaving get no calls (R10).

**API: sending (`apps/api/src/push/deliver.ts` new, `apps/api/src/push/activity.ts` new, `apps/api/src/push/activityText.ts` new)**
- `deliver(prisma, sender, messages)` is extracted from `catchUp.ts`. `catchUp.ts` is refactored to call it, with no change in behaviour.
- `flushActivity({prisma, sender, now})` runs under advisory lock key `1_016_001`:
  - Select pending rows with `dueAt <= now`, plus failed rows that are due a retry (R16).
  - Mark as `dropped` rows that are older than 1 h, whose recipient left, or whose target is gone (R7, R14).
  - Mark as `muted` rows whose type or project is muted (R20).
  - Group the rest by (user, project). Build the text in the user's language with `activityText.ts`: project-name title, 3 newest lines, "+N nữa / +N more" (R13).
  - The `data` sent with the push is `{kind:"activity", projectId, target, eventIds}`, where `target` follows R24.
  - Claim with compare-and-set on `attempts`, then `deliver`, then settle `sent` (R15, R16).
  - With no sender configured, it returns without error (R16).
- Text lines by type, vi / en:
  - assigned: "{actor} đã giao cho bạn {title}" / "{actor} assigned you {title}"
  - comment: "{actor} đã bình luận trong {title}" / "{actor} commented on {title}"
  - done: "{actor} đã hoàn thành {title}" / "{actor} finished {title}"
  - idea: "{actor} đã thêm ý tưởng {title}" / "{actor} added the idea {title}"
  - member joined: "{name} đã vào dự án" / "{name} joined the project"
- `activity/scheduler.ts`: `createTimerScheduler(flush)` keeps one timer for the earliest `dueAt` and re-arms after each flush; it is unref'd. `createManualScheduler()` is for tests. Both go through `AppDeps.activityScheduler`, wired in `index.ts`.
- `internal/routes.ts` tick: also call `flushActivity`, and delete events older than 30 days (R14, R33).

**API: settings and feed (`apps/api/src/activity/routes.ts`, new, mounted in `app.ts`)**
- `GET /me/notification-settings` returns `{types:{assigned,comment,done,idea,member_joined: boolean}, mutedProjectIds: string[]}`. Everything is on by default (R17, R21).
- `PUT /me/notification-settings/types/:type {enabled}` is idempotent and returns the settings (R18, R23).
- `PUT /projects/:projectId/notification-mute {muted}` returns 404 for a non-member and returns `{muted}` (R19, R23).
- `GET /me/activity?cursor=` returns 30 rows of the caller's own events, newest first, from the last 30 days, only from projects the caller is still a member of. Each row includes the actor's name, the snapshot title, the project name, the target ids and `read`. It returns `nextCursor` (R29, R30, R33, R35).
- `GET /me/activity/unread` returns `{hasUnread}` (R32).
- `POST /me/activity/read {eventIds}` and `POST /me/activity/read-all` update only the caller's rows and always return 204, whether or not the ids exist (R31, R35).
- All routes use `requireAuth`, so they return 401 when signed out (R23, R35).

**Mobile (`apps/mobile/src/activity/`, new)**
- `api.ts`: calls for the endpoints above, added to `lib/api.ts`.
- `ActivityProvider.tsx`:
  - holds the feed pages and `hasUnread`, and caches the first page in AsyncStorage for offline use (R34)
  - marks rows read optimistically
  - keeps a persisted pending-read set that is flushed when back online (R31, R34)
- `format.ts`, pure and tested:
  - `groupByDay`: Hôm nay / Hôm qua / Trước đó
  - `relativeTime`: VI/EN with `Intl.RelativeTimeFormat`, and "Hôm qua, 20:14" or "21/11" beyond today (R30)
  - `rowText`
  - `rowTarget`, which reuses the tap logic (R31)
- `app/(app)/(home)/activity.tsx` draws mockup 3a–3e, registered in `(home)/_layout.tsx` as "Hoạt động" with the "Đọc hết" header action (R29–R31, R34).
- Home header (mockup 2a, 2b): a `headerRight` bell on `index` with an orange dot when `hasUnread`, and accessible names "Hoạt động" or "Hoạt động, có mục chưa đọc". It pushes `/activity` (R32).
- Notification settings (mockup 4a–4c):
  - `notifications/useNotificationSettings.ts` loads the settings, flips a switch optimistically, and reverts on failure, showing the existing `ErrorText` (R27).
  - `account.tsx` gets a "Thông báo" section between Ngôn ngữ and Giao diện: 5 `Switch` rows, plus the note about reminders and the feed (R18, R22).
- Project screen (mockup 5a, 5b): a "Thông báo hoạt động" switch row in `projects/[id]/index.tsx`, under Thành viên and above Chi tiết (R19).
- Taps (mockup 1a–1c, navigation map §7):
  - `notificationLogic.ts` `TapTarget` gains `idea`, `members` and `project`. `tapDestination` handles each, falling back to `/projects` (R24).
  - `NotificationGlue.tsx` handles `kind:"activity"`: it routes, then marks the push's `eventIds` read (R31).
  - The foreground banner stays as it is for reminders (R25).
- `i18n/vi.json` and `i18n/en.json` get new keys for the screen, settings and bell, kept in parity (R26).

## Risks

- **Sensitive Areas: data, schema, public API.**
  - The feed and mark-read endpoints must only ever touch the caller's rows. They return 204 for unknown or foreign ids, so they don't reveal that an event exists.
  - Pushes must not reach someone who was removed from the project: membership is re-checked at send time and at feed read time (R7, R29).
  - The Sensitive reviewer looks at these.
- **Double sends** when the timer and the tick overlap: both run under one advisory lock, and the compare-and-set claim on `attempts` makes a second runner skip the row (R15). An API test runs both at the same time.
- **A lost timer** on restart or sleep: the tick recovers within 5 minutes (R14). On Render the window can then stretch to 5 minutes. That is accepted, and the spec says so.
- **Refactoring `catchUp.ts`** could break reminder pushes. The extraction is limited to the send/settle block, and the full reminder test file must still pass unchanged.
- **Changing `applyLastWriteWins`'s return type** touches every caller. It is additive, and the TypeScript build catches any misuse.
- **Migration order:** tickets #50–#53 may add migrations in parallel. Name this one by today's timestamp, and before the PR merges, re-check that it sorts after whatever reached `main` first (lesson).
- **New NOT NULL columns** go only on new tables, so there is no DROP DEFAULT in this release (lesson about render.yaml running migrations first).
- **The shared test database:** run the API suite once, alone. No parallel reviewers on the database (lesson).
- **Expo Go push** depends on `extra.eas.projectId`, which is still a setup step in #47. The server side is fully testable with the fake sender. Real delivery goes to the Test Handoff.

## Test Strategy

Commands (from `ourkit command`):
- `test`: `npm --prefix apps/api test && npm --prefix apps/mobile test`
- `lint`: `npm --prefix apps/mobile run lint`
- `build`: `npm --prefix apps/api run build`

There is no separate typecheck command. The API build is `tsc`, and the mobile lint covers the app. The API suite runs once, alone.

- **API tests (vitest, `createClock`, `createFakeSender`, manual scheduler).** One test per acceptance criterion: AC1–AC17, AC20, AC21, AC23, AC29, AC31's server half, AC33 and AC35.
  - The network-failure strategy is decided here so Review doesn't flip it (lesson): send failures use `createFakeSender`'s `failing` set, never a real port.
  - Existing reminder, task, comment, idea and invite tests must still pass.
- **Schema test** for the migration on an empty database and on existing data (AC28).
- **Mobile unit tests:**
  - tap routing (AC24)
  - grouping and relative time in VI/EN (AC30)
  - the bell dot and its accessible name (AC32)
  - the switch reverting on failure (AC27)
  - pending reads flushed when back online (AC34)
  - `parity.test.ts` (AC26)
- **Test Handoff, added to #47** (real iPhone, Expo Go, two accounts), because these can't be checked without a phone:
  - real push delivery and batching on the lock screen (1a, 1b)
  - the foreground banner (AC25)
  - tapping each kind of push (AC24)
  - the Notifications switches stopping pushes (AC18, AC19, AC22)
  - the Activity screen and its states against the mockup in light and dark, VI and EN (AC26, AC30, AC34)
  - VoiceOver names
