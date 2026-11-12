## Summary

Tasks inside a project (#6): create, edit, delete; status To do / Doing / Done; several assignees; due day with optional time; one list with status, "Assigned to me", "Only me" and "Due soon" filters; works offline on the shared sync queue.
Why: shop partners need to see who does what by when; checklists, comments, photos and reminders (#7–#10) attach to tasks next.
Verified: API 358/358 and mobile 447 tests, lint and build; four review rounds plus a sensitive-area review each round, ending with no blocking finding; all 29 acceptance criteria pass, 12 of them checked by the user on an iPhone.
Watch: run `db:deploy` before starting the new API (member removal now writes TaskAssignee); the tasks migration was renamed to 20261112060000_tasks so it sorts after #5's.
Left: an Android-only check of the time picker's minimum, and the non-blocking findings listed below.

## Details

**What's in it.**
- **API:** `Task` and `TaskAssignee` tables (one additive migration); routes under `/projects/:projectId/tasks` (GET, POST, PATCH, DELETE).
  - Every route checks membership; every "no such thing for you" case gives one 404 body, the same as the members route.
  - Writes take the project lock and re-check role under it.
  - Per-field last-write-wins, with the due day+time and the assignee set each one field.
  - Idempotent create on a phone-chosen UUID.
  - At most 1000 tasks per project (409 `task_limit_reached`); due years 1900–9999; control characters refused in task and project text.
  - Removing or leaving a member (#5 routes) now clears their assignments in that project.
- **Phone:**
  - Tasks share the one write queue with projects, through per-entity result handlers, so the queue has no task code.
  - A per-owner task cache, cleared on sign-out.
  - The task list (filters remembered per project, status change from the card, Done section closed by default, error state with retry).
  - Details, New and Edit screens, with the due date and time picked in place and no past values.
  - An assignee picker built on #5's member list and cache.
  - A two-column area-tile grid on the Project screen.

**Decisions with the user.**
- **Where tasks open:** only from the Project screen, through a two-column tile grid (Tasks plus Ideas, Products and Fixed costs as "Coming soon").
- **Who can do what:** any member edits any task; only the creator or an Owner deletes.
- **Due date and "Due soon":** an optional time on the due date; "Due soon" means within 3 days, overdue included.
- **Filters:** "Only me" added next to "Assigned to me".
- **Forms, changed at QA:** a new task has no status field (always To do); due pickers open inside the field; past days and times can't be picked.
- **Ticket #5 in parallel:** built in another session and merged into this branch before the assignee picker, which reuses its endpoint and cache.

Decision log:
- The date picker is `@expo/ui`, with no new dependency.
- Task and member 404s share one body.
- One member cache is shared with #5.
- A 1000-task cap instead of paging.

**Review.** 35 findings, 10 blocking, all fixed. Among them:
- Former members stuck on tasks blocked every later edit of that task.
- Task writes didn't take the project lock.
- The list showed "No tasks yet" when a fetch failed, and its Retry button was a no-op.
- The status pill was unreachable with VoiceOver.
- Refusal notices used project wording.
- The phone accepted years the server refused.
- A refresh-retry fix wasn't wired in.
- At QA: an empty assignee picker and a missing Owner delete control while the profile hadn't loaded, and server errors shown as "offline".

**Non-blocking findings left.**
- A create reusing another project's task id gets 409 `id_conflict`, not the shared 404. Low risk, because ids are random UUIDs.
- An offline change that adds someone who left meanwhile is refused whole, so title or status edits sent with it are lost, with a notice.
- A create whose reply was lost, retried after the task was deleted elsewhere, brings the task back. There are no tombstones.
- Any database that applied the old migration name `20261112000000_tasks` (only the test database did, and it was updated) would fail on deploy.
- Rollback: revert the code first, then drop `TaskAssignee`, `Task` and `TaskStatus` by hand.
- On Android the time picker may ignore the minimum time; a past time is still refused on save.

**Not verified.**
- Android was not tried; the hand checks were on iPhone only.
- The invites cap-race test from #5 timed out once after the merge and passed on every later run.

**QA**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | API tests: a title of 0 and 121 characters after trimming, a description of 2001 characters, and an unknown status are refused with `validation_failed`; a title of 120 characters, an empty description, each status and no due date are accepted; a new task without a status is To do. | API suite 358/358 passed (earnm_test); validation and defaults tests in tasks tests passed | ✅ pass |
| 2 | API tests: a due date with a day and time, and with a day only, are stored and returned as given; a time without a day is refused with `validation_failed`. | API suite 358/358 passed (earnm_test); 'stores and returns a day with a time, and a day only' and 'refuses a time without a day' passed | ✅ pass |
| 3 | API tests: assigning a project member works; adding a non-member, the same person twice, or 21 people is refused with `validation_failed`; a change that keeps an already-assigned former member, or removes them, is accepted; removing a member, and a member leaving, removes their assignments in that project only. | API suite 358/358 passed (earnm_test); assign member, refuse non-member/duplicate/21, keep or remove former member, and members-route clear-on-remove/leave tests (seeding a second project left untouched) passed | ✅ pass |
| 4 | API tests: a task created with a phone-chosen UUID is returned with that id; the same create sent twice leaves one task; a create reusing another project's task id is refused and doesn't change that task. | API suite 358/358 passed (earnm_test); returned id, repeated create, simultaneous creates and other-project id tests passed | ✅ pass |
| 5 | API tests: a Member can create a task, edit every field of a task created by the Owner, and change its status. | API suite 358/358 passed (earnm_test); 'lets a Member create a task, edit every field of an Owner's task' passed | ✅ pass |
| 6 | API tests: the creator and an Owner can delete a task; a Member who didn't create it gets `403`; a second delete gives `404`. | API suite 358/358 passed (earnm_test); creator and Owner delete, Member 403, second delete 404 passed | ✅ pass |
| 7 | API test: reading a project's tasks returns exactly that project's tasks with every field and assignees' display names. | API suite 358/358 passed (earnm_test); 'returns exactly this project's tasks' with assignees {id, displayName} passed | ✅ pass |
| 8 | API test: reading a project's members returns each member's id, display name and role. | API suite 358/358 passed (earnm_test); #5 members route tests (owners first, by join time) passed; endpoint returns userId, displayName, role | ✅ pass |
| 9 | API tests: task and member requests for a project the caller isn't in, a project that doesn't exist, and a task id from another project all give `404` with the same body. | API suite 358/358 passed (earnm_test); one 404 body for non-member, missing project, other project's task, compared with the members route 404 | ✅ pass |
| 10 | API test: every new endpoint without a token, and with an expired one, gives `401 not_signed_in`. | API suite 358/358 passed (earnm_test); every route without a token and with a token expired by advancing the clock past the session lifetime gives 401 not_signed_in | ✅ pass |
| 11 | API tests: deleting a project removes its tasks and assignments; deleting a user removes their assignments and leaves their created tasks with no creator, which a Member then can't delete and an Owner can. | API suite 358/358 passed (earnm_test); project-delete and user-delete cascade tests incl. Owner-only delete of creatorless task passed | ✅ pass |
| 12 | API tests: an older change to `status` is ignored while a newer change to `title` in the same request is accepted; a change with a time one day in the future is stored with the server's current time; assignees are replaced as a whole set by the newer change. | API suite 358/358 passed (earnm_test); older status ignored with newer title accepted, future time clamped, assignees replaced as a set | ✅ pass |
| 13 | API test: a fully ignored change returns `200` with the task's current values. | API suite 358/358 passed (earnm_test); 'answers 200 with the current values when every change is ignored' passed | ✅ pass |
| 14 | Test of the tasks sync layer: with a waiting rename of task A, a refresh returning the old title still shows the new title; a refresh without task B removes B. | mobile suite 419/419 passed; overlay keeps a waiting rename over a stale refresh; a task missing from the server list is removed | ✅ pass |
| 15 | By hand: open a project's tasks, turn on airplane mode, close and reopen the app: the task list and details show with the offline note. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 16 | Tests of the queue with task changes: two edits give one waiting change; create then edit give one create; create then delete give no request. | mobile suite 419/419 passed; queue merge tests (two edits, create+edit, create+delete sends nothing) passed | ✅ pass |
| 17 | Tests of the tasks outcomes: a task change answered `403` or `404` is removed, the local copy shows the server's version (or no task), and the "couldn't be saved" message appears; a `401` keeps it queued. By hand: change status, create and delete a task in airplane mode, reconnect, and see the changes on a second phone or in the API. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 18 | Test: a waiting task change for a project the server answers `404` for is dropped and the next waiting change is still sent. | mobile suite 419/419 passed; 'is dropped on 404 and the next waiting change is still sent' passed | ✅ pass |
| 19 | By hand: sign out and sign in as another person: no tasks or filter choices from the first person show. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 20 | Code check: the shared queue code has no reference to tasks; task kinds of change are registered from the tasks code. | grep of apps/mobile/src/sync non-test files finds no task reference; tasks register via queue.registerEntity in src/tasks/sync.ts | ✅ pass |
| 21 | By hand, following each move in requirement 21: the named screen opens; back by header and by swipe returns to where it was opened from; after creating, back doesn't reach the form; after deleting, back doesn't reach the deleted task. The Project screen shows the two-column tile grid above the details, with the Tasks tile's not-done count and the other three tiles disabled with "Coming soon" doing nothing when tapped; Home has no Tasks tile. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 22 | Unit test of the list ordering: overdue, due today, due later, no due date, then Done in its own group; tasks with the same due date ordered by creation time. By hand: the Done section starts closed and shows its count. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 23 | By hand: changing status from a card updates it at once and moves it to its new place in the list. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 24 | Unit tests of the filters: each status, "Assigned to me", "Only me" and "Due soon" alone and combined select the right tasks; a task assigned to me and someone else matches "Assigned to me" but not "Only me". By hand: the choices survive closing and reopening the app. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 25 | Unit tests of "due soon" with a fixed clock: a task due yesterday, today, and in three days counts; one due in four days, a Done task, and one with no due date don't; a day with no time counts until the end of that day. By hand: an overdue task says it is overdue in words. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 26 | By hand: a new project shows the invitation to create a task; filters matching nothing show the message and a way to clear them. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 27 | By hand: a task saves with a title only; an over-long title shows the field message without saving; the assignee picker lists the project's members, also offline; a due day can be set, a time added, and either cleared; return moves title → description and submit stays above the keyboard; a Member who didn't create the task sees no delete control; delete asks for confirmation naming the task. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 28 | By hand, in both languages: no untranslated text, dates read naturally in each language, and screens follow `DESIGN.md` and Decision 10. | checked by the user on an iPhone in Expo Go (npm run dev:phone, local API, dev DB) after the QA fixes: reported ok | ✅ pass |
| 29 | The migration applies cleanly to an empty database and to one with existing users and projects. | migration 20261112060000_tasks applied cleanly with prisma migrate deploy to the dev database that already had users and projects, and to the test database (earnm_test); the app then worked on it, checked by the user | ✅ pass |
