# Change Report: Members get push notifications for project activity (#16)

## Summary

What changed: there are now pushes for five events: being assigned, a new comment, Done, a new idea, and a new member. Pushes go only to the people involved, never to whoever acted, and are batched about 1 minute into one push per project. People can mute by type (Account) and by project (project screen). An Activity screen with read state is opened from a bell with an orange dot on Home.
Why: shop partners should hear about changes that involve them without keeping the app open (Decision 13). The user added the in-app feed and approved the mockup on 2026-11-25.
How it was verified: API 866 and mobile 1522 tests pass, and lint, type check and build pass. There were three reviews, plus a review of the fix commits. QA covered 35 criteria: 25 passed, 10 are by hand on an iPhone, and none failed. The migration was applied to an empty database and to one with data.
What to watch for: the new migration `20261125120000_activity` must run before the server starts. Delivery is at-least-once. On Render's free plan, a server restart can push the 1-minute batch out to the 5-minute tick.
What's left: the iPhone checks in #47 section J (Expo Go push needs `npx eas init`), and 5 small non-blocking findings listed below.

## Details

### Decisions

1. Tier is Feature, with Sensitive Areas schema, data and public API. It is one Epic Feature whose blockers are closed, and it adds tables and endpoints.
2. The activity feed, read state and bell dot are part of #16, at the user's request. The user approved a dot instead of a count.
3. The bell is on the Home header, the first screen, as approved in the mockup.
4. Each recipient row is the push queue, the feed row and the read state at once. Sends are triggered by a 1-minute in-process timer, and the 5-minute tick recovers anything the timer missed.
5. Prior art: `PushSender` is reused, and the reminder send-and-settle step is extracted into `push/deliver.ts`, so reminders and activity share it. The activity claim SQL is new.
6. Marking read while offline uses a small persisted set of pending reads, not `sync/queue.ts`.

Smaller choices made during Build:
- A user with no device token has their rows dropped.
- `data.eventIds` in a push is capped at the newest 50.
- Mute writes are race-safe (`createMany` with `skipDuplicates`).
- `applyLastWriteWins` now returns the fields it applied.

### Review

Three reviewers looked at the change: general, Sensitive Areas, and mobile. A fourth review covered only the fix commits. None found anything blocking. Of the 14 non-blocking findings, 9 were fixed:
- the timer now re-arms after each flush
- each tick step runs on its own
- push event ids are capped
- mute PUTs are race-safe
- mark-all-read made while offline is retried
- a stale settings load no longer overwrites a change
- signed-out loading no longer gets stuck
- `loadMore` checks the generation
- the at-least-once delivery is documented in the code

Left open, all non-blocking:
- `record.ts`: a row whose window already ended but which is still unsent starts a fresh window, which can give two pushes for one project.
- `push/activity.ts`: a crash between Expo accepting a push and the rows being settled can resend once. This is documented as at-least-once.
- Mark-all-read made while offline also marks events that arrive after the tap.
- `scheduler.ts` reads `nextDueAt` through an untyped cast.
- If both reminders and activity fail in one tick, only the first error is returned; the second is logged.

### QA

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | API test: editing a task from assignees {A} to {A, B} as C notifies B only. Creating a task with assignees {A, B} as A notifies B. Converting an idea to a task with assignees creates "assigned" events for those assignees. | record.test.ts 'assigned (AC1)': create notifies others not creator; PATCH records only newly added; idea->task records assigned. Full API suite 866/866. | ✅ pass |
| 2 | API test: on a task created by A, assigned to B and commented on earlier by D, a comment by B notifies A and D but not B. A comment with "Nhắc kèm" behaves the same. | record.test.ts 'comment (AC2)': creator, assignees, earlier commenters, not author; remindWith same. | ✅ pass |
| 3 | API test: todo → done notifies the creator, assignees and commenters, except the person who acted. Done → todo and todo → doing send nothing. Done → todo → done sends a second Done. | record.test.ts 'done (AC3)': todo->done notifies all involved but actor; todo->doing and done->todo nothing; done->todo->done second event. | ✅ pass |
| 4 | API test: creating an idea in a project with members A, B and C, as A, notifies B and C. | record.test.ts 'idea (AC4)'. | ✅ pass |
| 5 | API test: when D joins a project with members A and B through an invite, A and B are notified and D is not. | record.test.ts 'member joined (AC5)': existing members notified, joiner not. | ✅ pass |
| 6 | Covered by tests 1-5. In each, the actor has no event addressed to them. | record.test.ts 'never includes the actor, in any path (AC6)'. | ✅ pass |
| 7 | API test: if a recipient leaves the project, or the task is deleted, before the window ends, nothing is sent to them for that event. | push/activity.test.ts: nothing sent when recipient left or task/idea deleted; valid events in same batch kept (AC7). | ✅ pass |
| 8 | API test: a PATCH that last-write-wins rejects, or a repeated create with the same client id, adds no event. | record.test.ts: LWW-rejected PATCH and repeated client-id create add nothing (AC8). | ✅ pass |
| 9 | API test: an assignment whose recorded edit time is 61 minutes before the request is applied but adds no event. One at 59 minutes adds an event. | record.test.ts 'late edits (AC9)': 61 min -> late, no dueAt; 59 min -> pending. | ✅ pass |
| 10 | API test: changing an ingredient price, a task title, a checklist item, a vote, a role, or a member leaving adds no event. The existing reminder tests still pass. | record.test.ts 'other changes record nothing (AC10)'; catchUp.test.ts reminder tests pass in full suite. | ✅ pass |
| 11 | API test: the event row is written in the same transaction as the change. If the change rolls back, there is no event. | record.test.ts 'transaction (AC11)': failed request leaves no event; rows vanish when tx fails. | ✅ pass |
| 12 | API test with a fake clock and the fake sender: two events for one recipient 20 seconds apart arrive in one push at about 1 minute. An event at 90 seconds goes in a second push. | activity.test.ts (AC12): nothing before window ends, then one push; later event opens own window, second push. | ✅ pass |
| 13 | API test: events from two projects give two pushes, each titled with its project name. Five events in one project give 3 lines plus "+2 more" in English or "+2 nữa" in Vietnamese, following `User.language`. | activity.test.ts (AC13) one push per project titled by project, 3 lines + more count in user language; activityText.test.ts VI/EN wording. | ✅ pass |
| 14 | API test: with the in-process timer off, a tick sends batches whose window has ended. An event older than 1 hour is marked dropped and not sent. | activity.test.ts (AC14): tick without timer sends due batches; >1h event dropped; scheduler.test.ts covers timer. | ✅ pass |
| 15 | API test: a recipient with two tokens gets the push on both. Running the timer and a tick at the same time sends each event once. | activity.test.ts (AC15): all devices; concurrent flushes and flush+tick send each event once. | ✅ pass |
| 16 | API test: a failing sender is retried at most 3 times within an hour. A `DeviceNotRegistered` token is deleted. With no push sender set, the tick and the timer finish without error. | activity.test.ts (AC16): max 3 retries, recovery, DeviceNotRegistered deleted, no sender no error. | ✅ pass |
| 17 | API test: a new user's settings show all five types on and no muted projects. | routes.test.ts 'starts with every type on and no project muted'. | ✅ pass |
| 18 | API test plus by-hand check against the approved mockup: turning off "Comments" in Account stops comment pushes in every project, while the other types still arrive. | API side passes (routes.test.ts settings; activity.test.ts muted type not sent). By-hand on phone and mockup 4a: Test Handoff / #47. | 🙋 by hand |
| 19 | API test plus by-hand check against the mockup: muting project P stops all activity pushes from P, and project Q still pushes. | API side passes (project mute tests). By-hand on phone and mockup 5a-5b: Test Handoff / #47. | 🙋 by hand |
| 20 | API test: an event waiting in its window is not sent if the recipient mutes its type or project before the window ends. | activity.test.ts (AC20): muted type and muted project both marked muted, not sent. | ✅ pass |
| 21 | API test: settings saved from one session are returned to another session of the same user. | routes.test.ts 'keeps settings across sessions of the same user and apart from other users'. | ✅ pass |
| 22 | API test: a muted user still gets reminder pushes. By hand: the Notifications section shows the note that reminders can't be muted. | API side passes (reminders still sent to user who muted all). Note on screen not checked: Test Handoff / #47. | 🙋 by hand |
| 23 | API test: the mute endpoints return 401 when signed out, and 404 for a project the user isn't a member of. Sending the same change twice gives the same stored result. | routes.test.ts: 401 on all endpoints, 404 for non-member/unknown/bad id, repeated and concurrent identical PUTs same result. | ✅ pass |
| 24 | Mobile unit tests of the tap logic: a single task gives the task route, a single idea gives `/projects/[id]/ideas/[ideaId]`, only joins gives the Members route, mixed events give the project route, and a missing target gives `/projects`. By hand on a phone: tapping each kind opens the right screen. | Unit logic passes (rowTarget, tapDestination; activity.test.ts targets). Real taps on a phone: Test Handoff / #47. | 🙋 by hand |
| 25 | By hand: with the app open, an activity push shows as a banner. | Not checkable without a phone: Test Handoff / #47. | 🙋 by hand |
| 26 | By hand against the mockup in light and dark, in VI and EN. `parity.test.ts` passes. The switches have accessible names. | parity.test.ts passes; switches have accessibilityLabel in source. Look vs mockup, light/dark, VI/EN, VoiceOver: Test Handoff / #47. | 🙋 by hand |
| 27 | Mobile test or by hand: with the API failing, a switch flips back and the error notice shows. | settingsLogic.test.ts 'reverts the switch and reports a failure when the save fails'; label exists in VI/EN. | ✅ pass |
| 28 | `prisma migrate deploy` succeeds on an empty database and on a copy of the current schema with data. | Test DB setup applied all migrations incl. 20261125120000_activity to an empty DB; schema.test.ts 'activity migration on existing data' keeps rows, new tables empty. | ✅ pass |
| 29 | API test: with the Comments type and project P muted, a comment in P adds no push but still appears in the feed. A late (61-minute) assignment appears in the feed at its edit time. After leaving P, P's events are no longer returned. | routes.test.ts 'shows events from muted types and projects, and a late event at its own time' and 'drops a project's events once the caller leaves'. | ✅ pass |
| 30 | Mobile unit test of grouping and relative time, in VI and EN. By hand against the mockup. | format.test.ts / list.test.ts cover grouping and relative time VI/EN. Screen vs mockup 3a: Test Handoff / #47. | 🙋 by hand |
| 31 | API test: marking an event read makes it read in a second session of the same user. Mark-all marks every event. Mobile unit test: a tap on a row resolves to the same routes as test 24. By hand: opening a push clears those rows' unread mark. | API tests pass (read across sessions, read-all, foreign ids ignored); rowTarget routes match push taps. Push open clears unread on phone: Test Handoff / #47. | 🙋 by hand |
| 32 | Mobile unit test: the dot is hidden at 0 unread and shown at 1 or more, and the accessible name changes with it. By hand: the bell is in the Home header, and back returns to Home. | bellState tests cover dot and accessible name. Bell in Home header, back to Home: Test Handoff / #47. | 🙋 by hand |
| 33 | API test: the feed returns 30 rows per page, newest first, with a cursor for the next page, and returns nothing older than 30 days. | routes.test.ts 'pages 30 at a time by cursor, stable with equal occurredAt, nothing older than 30 days'; bad cursor 400. | ✅ pass |
| 34 | By hand against the mockup: the empty, loading and offline states. Mobile test: a mark-read made offline is sent once the phone is back online. | pendingRead tests: offline mark-read kept and sent on reconnect. Empty/loading/offline states vs mockup: Test Handoff / #47. | 🙋 by hand |
| 35 | API test: the feed endpoints return 401 when signed out. User B can't see or mark user A's events: marking A's event as B returns the same response as an unknown id, and A's event stays unread. | routes.test.ts: 401 signed out, never shows another user's rows, 204 for foreign ids with no change. | ✅ pass |

### Not verified

- Nothing was run on a device or simulator. These are untested:
  - real Expo delivery
  - the banner
  - tap routing on a phone
  - the look against the mockup, in light and dark and in VI and EN
  - VoiceOver
- All of these are in #47, section J, and in the Test Handoff below.
- The `ActivityProvider` and `useNotificationSettings` React code is covered by type check and lint only. Its logic is in tested pure modules.
- `prisma migrate deploy` was not run on a copy of the real dev database. Before testing on a phone, run `npm --prefix apps/api run db:deploy`.

### Test Handoff

1. **AC18, AC19, AC22: the switches stop pushes.**
   - On A: Account > Thông báo, turn off "Bình luận mới".
   - B comments on a task A is on, in P, then marks it Done.
   - Expected: no comment push, but the Done push arrives. The section shows the note about reminders.
   - On A, on project P's screen, turn off "Thông báo hoạt động".
   - B adds an idea in P and one in Q.
   - Expected: only Q's push arrives.
2. **AC24, AC25, AC31: batching, banner and taps.**
   - A locks the phone. B comments twice within 1 minute.
   - Expected: one push titled P with both lines. Tapping it opens the task and clears the unread dots.
   - Repeat for a new idea (opens the idea), a join (opens Thành viên), and mixed events (opens the project).
   - With the app open, an activity push shows as a dark banner.
3. **AC26, AC30, AC32, AC34: the Activity screen and bell against the mockup.**
   - The bell dot shows, and clears after "Đọc hết".
   - Rows are grouped by day, with icons and relative times.
   - Check the empty, loading and offline states. Mark-all-read made offline syncs after reconnecting.
   - Check light and dark, VI and EN, and VoiceOver names.
