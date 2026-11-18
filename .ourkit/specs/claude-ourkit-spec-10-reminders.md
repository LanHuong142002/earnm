# Spec: Assignees are reminded about tasks by push notification

Ticket: #10 (Epic F9). Tier: Feature. Sensitive Areas: data, schema, public-api. Mockup: `.ourkit/mockups/claude-ourkit-spec-10-reminders.html` (bản 1, approved by the user on 2026-11-18). Mode: Hands-off.

## Goal

A task can carry several reminders, one-off or repeating. When one is due, the phones of the chosen people show a notification on the lock screen and in Notification Center with the task's title, due date and up to 3 latest "Nhắc kèm" comments (from #8), and tapping it opens the task. People stop forgetting to buy supplies or meet the landlord (Decision 5).

Today tasks, comments and their sync exist (`apps/api/prisma/schema.prisma`, `apps/api/src/tasks/routes.ts`, `apps/api/src/comments/routes.ts`, `apps/mobile/src/sync/queue.ts`, `apps/mobile/src/tasks/syncCycle.ts`). `POST /internal/tick` runs every 5 minutes but does nothing yet (`apps/api/src/internal/routes.ts`). There is no push library, no device-token model and no EAS project id. Reminders follow the existing conventions: phone-chosen ids, per-field last-write-wins, offline queue.

**Delivery model (option B, chosen by the user on 2026-11-18):** local notifications plus free push through Expo's push service while the team runs the app in Expo Go (no paid Apple account). Each recipient's phone schedules its own notifications from the reminders it knows about and reschedules them after every sync, so reminders fire on time even offline. The server covers phones that are out of date: on each `/internal/tick` it sends a push for each occurrence due since the previous tick to every recipient who has no device that synced after the reminder's **content version** (the later of the reminder's last change and the task's latest "Nhắc kèm" change). So a reminder someone else adds still arrives, at most one tick late, and a phone never shows the same occurrence twice. Push needs a free EAS project id; without it, the app stays on local notifications only.

## Requirements

### Reminders

1. A project member can add a reminder to a task in that project. A reminder has a start date and time (minutes precision), a repeat rule, an optional end date, and a list of recipients.
2. Repeat rules: **once**; **daily**; **weekly** on one or more chosen weekdays; **monthly** on the start date's day of month (a month without that day uses its last day).
3. The end date, when set, is on or after the start date; no occurrence happens after the end of that day.
4. Recipients are project members, at least 1, at most 20. New reminders default to the task's assignees, or to its creator if it has none.
5. A new reminder defaults to the due date at the due time, or 9:00 on the due date, or 9:00 tomorrow if there's no due date.
6. A one-off reminder whose time has already passed is refused when created or when its time is changed.
7. A task holds at most 5 reminders; a 6th is refused with a distinct error.
8. Any project member can edit or delete any reminder of a task in that project. Deleting asks for confirmation on the phone.
9. Times are stored with the creating phone's timezone (IANA name) and occurrences are computed in that timezone.
10. While the task's status is **done**, its reminders don't fire. Moving it back to not done resumes future occurrences; past ones are not sent late.
11. Deleting a task, or its project, deletes its reminders. A recipient who leaves the project stops receiving them and is dropped from the list.
12. Edits resolve last-write-wins per field (`time`, `repeat`, `endDate`, `recipients`), like task fields. Creating with an existing id on the same task is idempotent; on another task it's `409`.
13. Only members of the task's project can read or write its reminders; others get `404`, signed-out requests `401`.

### Devices and notifications

14. A signed-in phone that has notification permission and an EAS project id registers its Expo push token with the API; a token belongs to one user at a time (registering it again as another user moves it), and signing out unregisters it. Each task-list sync records the time on the caller's token.
15. Permission is asked the first time a person saves a reminder, after a short in-app explanation sheet ("Tiếp tục" / "Để sau"). The reminder is saved either way. The app never asks at launch.
16. Each occurrence notification shows: title = task title; first line = due date/time and project name (or just project name with no due date); then up to 3 latest "Nhắc kèm" comments as "Name: text", newest first, each cut to fit. The reminders the phone syncs carry each task's latest 3 "Nhắc kèm" comments, so this works for tasks the person hasn't opened.
17. Tapping a notification opens that task's screen, after sign-in if needed; if the task is gone or the person is no longer a member, the app opens the project list with no error.
18. The phone reschedules its local notifications after every successful sync, on app start, and when reminders change locally, covering occurrences in the next 14 days only for reminders where this user is a recipient (iOS keeps at most 64 pending; the nearest win).
19. Removed (2026-11-18): no separate wake-up push; requirement 20 covers out-of-date phones.
20. On each `/internal/tick`, the server sends a visible push (same content as requirement 16) for each occurrence due since the previous tick (at most 15 minutes back) to recipients with no device synced after the reminder's content version, once per occurrence per user (a send that fails is retried up to 3 times within an hour), and never for done tasks. Tokens the push service reports as no longer registered are deleted. With no push configuration, the tick sends nothing.
21. Reminders can't be muted (Decision 13).

### On the phone: screens

22. The task screen has a **Nhắc nhở** section right below the info card, with "N/5" and "＋ Thêm" (grey with "Tối đa 5" at the limit). Each row shows time and repeat ("8:00 · Hằng ngày", "T6, 21 Thg 11 · 15:00 · Một lần", "9:00 · T2, T4, T6") and a small line with recipients and end date. Tapping a row opens it for editing.
23. With no reminders: one inviting line and a secondary "Thêm lời nhắc" button.
24. With the task done: rows are greyed, with the line "Đã dừng vì công việc đã xong."
25. If this phone's notification permission is denied: a `dangerBg` notice saying this phone won't be reminded but others will, with "Mở Cài đặt" opening iOS Settings.
26. The reminder screen ("Lời nhắc mới" / "Sửa lời nhắc"): date and time fields, a 4-way repeat control (Một lần / Ngày / Tuần / Tháng), weekday buttons for weekly, "Kết thúc" Không bao giờ / Vào ngày with a date field, recipients as checkboxes with "được giao" beside assignees, primary "Lưu", and "Xoá lời nhắc" when editing. Selections are shown by highlight only, with no tick marks (user's review, 2026-11-18); checkboxes keep their tick.
27. Errors show under the field: a past time for a one-off; no recipients; "Lưu" disabled while invalid.
28. Offline, adding, editing and deleting reminders are queued like comments; a waiting row shows "Chờ lưu"; local notifications on this phone are rescheduled at once. A change refused for good shows the existing rejected-change notice.
**Navigation:** task screen → "＋ Thêm" or "Thêm lời nhắc" pushes "Lời nhắc mới"; tapping a row pushes "Sửa lời nhắc". Back (chevron or swipe) returns to the task screen without saving; "Lưu" and a confirmed delete pop back to it. The explanation sheet (R15) opens over the task screen after the pop, and closes back to it. A notification tap pushes the task screen onto the project stack so back goes to the task list.

29. Light and dark mode with `DESIGN.md` tokens, VI and EN, 44pt targets, accessible names.

### Data

30. A migration adds reminders, reminder recipients, device push tokens and a record of sent pushes. It applies to empty and existing databases.

## Acceptance Criteria

1. API test: a member creates a reminder of each repeat rule; it comes back with all fields.
2. Unit test (occurrence calculator on the phone): once, daily, weekly on chosen days, monthly incl. 31st → last day; DST-free timezone and one with DST.
3. API test: end date before start is refused; unit test: no occurrence after the end date.
4. API test: 0 or 21 recipients, or a non-member recipient, are refused with `validation_failed`.
5. Unit test: the default time and recipients for each case in requirement 5 and 4.
6. API test: a past one-off is refused on create and on time change.
7. API test: the 6th reminder is refused with `reminder_limit_reached`.
8. API test: a non-creator member edits and deletes a reminder.
9. Unit test: occurrences are computed in the stored timezone.
10. Unit test: a done task yields no occurrences; reopening yields only future ones.
11. API test: deleting the task removes reminders; removing a member drops them from recipients.
12. API test: an older edit doesn't overwrite a newer one per field; the same id twice gives one reminder; on another task `409`.
13. API test: non-member `404`, signed out `401`, for list, create, edit, delete.
14. API test: registering a token, registering it again as another user moves it, unregistering removes it; a task-list fetch updates the token's sync time.
15. By hand (dev build on an iPhone): first save shows the explanation sheet, then the iOS prompt; "Để sau" still saves.
16. Unit test: notification content for with/without due date and 0–4 "Nhắc kèm" comments.
17. By hand: tapping a notification opens the task; for a deleted task, the project list.
18. Unit test: the scheduler picks only this user's reminders, 14 days ahead, nearest 64, and is idempotent. By hand: a reminder fires on a locked phone in airplane mode.
19. Check: no push is sent at the moment a reminder changes.
20. API test (push sender faked): tick sends one push per due occurrence to out-of-date recipients only (including when a "Nhắc kèm" comment is newer than their last sync), none twice across ticks, none for done tasks; invalid tokens are deleted; nothing is sent without configuration.
21. Check: there is no mute setting for reminders.
22. By hand, against mockup 1a: the Nhắc nhở section sits below the info card with N/5, ＋ Thêm and rows; at 5, ＋ Thêm is grey with "Tối đa 5".
23. By hand, mockup 1b: empty state line and button.
24. By hand, mockup 1c: done task greys rows with the stopped line. Unit test: the row view model marks rows stopped.
25. By hand, mockup 1d: with permission denied, the notice shows and "Mở Cài đặt" opens Settings.
26. By hand, mockups 2a–2c: the reminder screen, weekly days, end date, recipients, delete confirm; selections highlighted with no ticks.
27. By hand, mockup 2d: field errors and disabled Lưu. Unit test: form validation.
28. Unit test: queued reminder changes merge per reminder. By hand, mockup 4c: offline add shows "Chờ lưu" and syncs after reconnect.
29. By hand, mockup 4d: dark mode; also EN text and VoiceOver names on rows and buttons.
30. Check: `prisma migrate deploy` succeeds on an empty test database and on one with existing tasks.

## Out of Scope

- Snooze, widgets, Live Activities (deferred by the ticket).
- Push outside Expo Go (dev build, TestFlight, App Store), which needs a paid Apple Developer account.
- Activity push for comments, assignments, ideas (#16).
- Android (the app is iPhone only).
- Per-person notification settings or muting.
- Reminders on ideas.

## Open Questions

None. Answered by the user on 2026-11-18: mockup assumptions confirmed; option B (local notifications plus free Expo push in Expo Go).
