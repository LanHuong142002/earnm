# Members get push notifications for project activity

Ticket #16 · Epic F11 (`.ourkit/epics/epic-mvp.md`) · Tier Feature · Sensitive Areas: data, schema, public-api · Mode: Pair

## Goal

Shop partners hear about project activity that involves them, so they can react without keeping the app open all day. Five events trigger a push: being assigned a task, a new comment, a task becoming Done, a new idea, and a new member joining. Pushes go only to the people involved and never to the person who acted. Events that arrive close together are batched into one push per project. People can mute each type everywhere, or all activity from one project (Decision 13). The app also gets an activity screen, "Hoạt động" / "Activity". It lists the same events, so nothing is lost when a push is dismissed or muted.

Existing code this builds on:
- Pushes are sent through `apps/api/src/push/sender.ts` to Expo, using the phone tokens in `DevicePushToken`. A user can have up to 10 tokens.
- Reminder pushes come from `runCatchUp` (`apps/api/src/push/catchUp.ts`), which `POST /internal/tick` calls every 5 minutes. The free server sleeps after 15 idle minutes, and the tick wakes it.
- A tap on a push is routed by `apps/mobile/src/tasks/reminders/notificationLogic.ts`. It handles tasks only today.
- Push text is written on the server in the recipient's `User.language` (vi or en).

Decisions confirmed with the user on 2026-11-25:
- Comments and Done also go to earlier commenters.
- Events are saved and sent about 1 minute after a recipient's first event, and the tick sends any that were left behind.
- Types are muted globally and projects are muted as a whole.
- A batch is one push per project.
- Every change to Done pushes.
- Edits that reach the server more than 1 hour late don't push.
- Taps open the idea, or the Members screen.
- The in-app activity feed is part of this change (the user asked on 2026-11-25). Its details below were proposed by Claude, and the user will check them with the mockup.

## Requirements

### Events and recipients

1. **Assigned.** When people are added as assignees, each newly added assignee is notified. This applies to editing a task, creating a task with assignees, and converting an idea to a task with assignees. People who were already assignees, and people removed, are not notified.
2. **Comment.** When a comment is added to a task, the task's creator, its assignees and everyone who has commented on it before are notified. This includes comments sent with "Nhắc kèm".
3. **Done.** Every time a task's status changes to Done from another status, the task's creator, its assignees and everyone who has commented on it are notified. That includes a task that was reopened and finished again. A change between To do and Doing, or a reopen, is not pushed.
4. **New idea.** When an idea is created in a project, every member of that project is notified.
5. **New member.** When someone joins a project through an invite, every member who was already in the project is notified.
6. **Not the person who acted.** The person who caused an event is never notified about it, even if they are also its creator, assignee, commenter or a member.
7. **Members only.** A person is notified only if they are a member of the project when the push is sent. If they left, or the task or idea no longer exists when the push is sent, that event is dropped for them.
8. **Only changes that took effect.** An edit that last-write-wins rejects, or a repeated create with the same client id, causes no event.
9. **Late edits don't push.** A change made more than 1 hour before it reaches the server is still applied, but causes no push. Its age is measured from the time the phone recorded it, where the request carries that time, and otherwise from when the server received it.
10. **Other changes don't push.** Ingredient price changes, other task fields, checklist items, votes, role changes and members leaving cause no activity push. Reminders keep working as they do now, separately from this.

### Batching and sending

11. **Saved before sending.** Each event is saved together with the change that caused it, so a crash or a server sleep doesn't lose it.
12. **One-minute window.** A recipient's first unsent event starts a 1-minute window. When the window ends, all of that recipient's events from the window are sent together. A later event starts a new window.
13. **One push per project.** A batch is one push per project.
    - Title: the project name.
    - Body: up to 3 lines, newest first, such as "Lan đã bình luận trong Đặt bột" / "Lan commented on Order flour". If there are more events, a last line gives the count, such as "+2 nữa" / "+2 more".
    - Language: the recipient's language.
    - Each line names who acted and the task title, the idea title, or the new member's name.
14. **Recovery by the tick.** Every tick sends any batch whose window has ended but that was never sent, for example after a restart. An event still unsent 1 hour after it happened is dropped.
15. **Each phone, at most once.** Each batch goes to every phone token the recipient has. The same event is never in two delivered pushes.
16. **Failures.** A failed send is retried up to 3 times within an hour. Invalid tokens are deleted, as reminder pushes do now. If push isn't set up on the server, nothing is sent and nothing fails.

### Muting

17. **Default.** All five types are on for everyone by default.
18. **Mute by type.** Each person can turn each of the five types on or off for all their projects. This is done in a "Thông báo" / "Notifications" section of the Account screen, with one switch per type.
19. **Mute by project.** Each person can mute all activity pushes from one project, with a switch on that project's screen. Muting one project doesn't affect the others.
20. **When mutes apply.** A mute applies when the push is sent, so muting stops events that are already waiting. Unmuting doesn't bring back events that were dropped while muted.
21. **Mutes follow the person.** Mute settings are stored on the server for each person, so they are the same on all of that person's phones, and they survive signing out and back in.
22. **Reminders can't be muted.** Reminder pushes ignore every mute (Decision 13). The Notifications section says so.
23. **API rules.** The mute settings API needs a signed-in user (401 otherwise). Muting a project the person isn't a member of returns 404. Changing a project mute returns the new setting, and sending the same change twice gives the same result.

### Opening a push

24. **Where a tap goes.**
    - If every line is about one task, the tap opens that task.
    - If every line is about one idea, the tap opens that idea.
    - If every line is a new member, the tap opens the project's Members screen.
    - Otherwise, the tap opens the project.
    - If the target is gone, or the person is no longer a member, the tap opens the project list, as reminder taps do today.
25. **Shown in the app.** A push that arrives while the app is open shows as a banner, like reminder pushes.

### Screens and quality

26. **Look and languages.** The new switches follow `DESIGN.md`, light and dark. All text is in VI and EN, with matching keys in both language files. Touch targets are at least 44pt, and each switch has an accessible name.
27. **Saving a switch.** Turning a switch on or off shows the new state at once. If saving fails, the switch goes back to its old state and the existing error notice is shown.

### Data

28. **Migration.** The migration adds tables for saved activity events, their delivery and read state, and for mute settings. It applies to an empty database and to one with existing data.

### Activity feed

29. **What it lists.** The Activity screen lists, for the signed-in person, every event they would be notified about under requirements 1-9, newest first. Mutes don't hide anything here: muting only stops the push.
    - An edit that reached the server late (requirement 9) still appears here, at the time it was made.
    - Events from projects the person has since left are not shown.
30. **Rows.** Each row shows who acted, what happened and on what (as in requirement 13), the project name, and a relative time such as "5 phút trước" / "5 min ago". Rows are grouped under "Hôm nay" / "Today", "Hôm qua" / "Yesterday", and "Trước đó" / "Earlier".
31. **Read and unread.** New rows are unread and marked visibly.
    - Tapping a row marks it read and opens its target. The targets and fallbacks are as in requirement 24, for that one event.
    - Opening a push marks the events in it as read.
    - "Đọc hết" / "Mark all read" marks every row read.
    - Read state is stored on the server, so it is the same on all of the person's phones.
32. **Entry point and badge.** A bell button at the right of the Home screen's header opens the Activity screen, pushed with back and swipe-back. While there are unread events, the bell shows an orange dot, with no number. Its accessible name says so: "Hoạt động, có mục chưa đọc" / "Activity, unread items".
33. **How far back.** The screen shows the last 30 days. It loads 30 rows at a time and loads more on scroll. Events older than 30 days may be deleted.
34. **States.**
    - Empty: "Chưa có hoạt động nào" / "No activity yet".
    - Loading: placeholder rows.
    - Offline or a failed load: the last loaded list stays visible with the existing offline notice. Marking rows read while offline is retried when the phone is back online.
35. **API rules.** The feed and mark-read endpoints need a signed-in user (401 otherwise). They only ever return or change the caller's own events. Marking an event read twice, or marking someone else's event, changes nothing and doesn't reveal that the event exists.

## Acceptance Criteria

1. API test: editing a task from assignees {A} to {A, B} as C notifies B only. Creating a task with assignees {A, B} as A notifies B. Converting an idea to a task with assignees creates "assigned" events for those assignees.
2. API test: on a task created by A, assigned to B and commented on earlier by D, a comment by B notifies A and D but not B. A comment with "Nhắc kèm" behaves the same.
3. API test: todo → done notifies the creator, assignees and commenters, except the person who acted. Done → todo and todo → doing send nothing. Done → todo → done sends a second Done.
4. API test: creating an idea in a project with members A, B and C, as A, notifies B and C.
5. API test: when D joins a project with members A and B through an invite, A and B are notified and D is not.
6. Covered by tests 1-5. In each, the actor has no event addressed to them.
7. API test: if a recipient leaves the project, or the task is deleted, before the window ends, nothing is sent to them for that event.
8. API test: a PATCH that last-write-wins rejects, or a repeated create with the same client id, adds no event.
9. API test: an assignment whose recorded edit time is 61 minutes before the request is applied but adds no event. One at 59 minutes adds an event.
10. API test: changing an ingredient price, a task title, a checklist item, a vote, a role, or a member leaving adds no event. The existing reminder tests still pass.
11. API test: the event row is written in the same transaction as the change. If the change rolls back, there is no event.
12. API test with a fake clock and the fake sender: two events for one recipient 20 seconds apart arrive in one push at about 1 minute. An event at 90 seconds goes in a second push.
13. API test: events from two projects give two pushes, each titled with its project name. Five events in one project give 3 lines plus "+2 more" in English or "+2 nữa" in Vietnamese, following `User.language`.
14. API test: with the in-process timer off, a tick sends batches whose window has ended. An event older than 1 hour is marked dropped and not sent.
15. API test: a recipient with two tokens gets the push on both. Running the timer and a tick at the same time sends each event once.
16. API test: a failing sender is retried at most 3 times within an hour. A `DeviceNotRegistered` token is deleted. With no push sender set, the tick and the timer finish without error.
17. API test: a new user's settings show all five types on and no muted projects.
18. API test plus by-hand check against the approved mockup: turning off "Comments" in Account stops comment pushes in every project, while the other types still arrive.
19. API test plus by-hand check against the mockup: muting project P stops all activity pushes from P, and project Q still pushes.
20. API test: an event waiting in its window is not sent if the recipient mutes its type or project before the window ends.
21. API test: settings saved from one session are returned to another session of the same user.
22. API test: a muted user still gets reminder pushes. By hand: the Notifications section shows the note that reminders can't be muted.
23. API test: the mute endpoints return 401 when signed out, and 404 for a project the user isn't a member of. Sending the same change twice gives the same stored result.
24. Mobile unit tests of the tap logic: a single task gives the task route, a single idea gives `/projects/[id]/ideas/[ideaId]`, only joins gives the Members route, mixed events give the project route, and a missing target gives `/projects`. By hand on a phone: tapping each kind opens the right screen.
25. By hand: with the app open, an activity push shows as a banner.
26. By hand against the mockup in light and dark, in VI and EN. `parity.test.ts` passes. The switches have accessible names.
27. Mobile test or by hand: with the API failing, a switch flips back and the error notice shows.
28. `prisma migrate deploy` succeeds on an empty database and on a copy of the current schema with data.
29. API test: with the Comments type and project P muted, a comment in P adds no push but still appears in the feed. A late (61-minute) assignment appears in the feed at its edit time. After leaving P, P's events are no longer returned.
30. Mobile unit test of grouping and relative time, in VI and EN. By hand against the mockup.
31. API test: marking an event read makes it read in a second session of the same user. Mark-all marks every event. Mobile unit test: a tap on a row resolves to the same routes as test 24. By hand: opening a push clears those rows' unread mark.
32. Mobile unit test: the dot is hidden at 0 unread and shown at 1 or more, and the accessible name changes with it. By hand: the bell is in the Home header, and back returns to Home.
33. API test: the feed returns 30 rows per page, newest first, with a cursor for the next page, and returns nothing older than 30 days.
34. By hand against the mockup: the empty, loading and offline states. Mobile test: a mark-read made offline is sent once the phone is back online.
35. API test: the feed endpoints return 401 when signed out. User B can't see or mark user A's events: marking A's event as B returns the same response as an unknown id, and A's event stays unread.

## Out of Scope

- Reminders (#10) and muting them.
- Pushes for ingredient prices, votes, checklist items, task fields other than assignees and status, role changes, or members leaving.
- Filtering or searching the activity feed, deleting rows from it, and listing reminders in it.
- Muting one type in one project only, quiet hours, and email notifications.
- Watching or following a task you're not involved in.
- Android, and push outside Expo Go (as in #10).

## Open Questions

None.
