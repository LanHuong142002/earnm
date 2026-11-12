# Spec: Members can track tasks in a simple list

Ticket: #6 (Epic F5). Tier: Feature. Sensitive Areas: data, schema, public API.

## Goal

Inside a project, members can write down what needs doing, who does it and by when: create, edit and delete tasks with a title, description, status (To do / Doing / Done), several assignees and a due date, and see them as one list with status, "My tasks" and "Due soon" filters. It works offline the same way projects do: the phone shows what it last loaded, changes show at once, and they are sent when the connection comes back, with conflicting edits resolved last-write-wins per field.

This matters because tasks are the core of planning the shop together, and checklists, labels (#7), comments (#8), photos (#9) and reminders (#10) all attach to tasks later. Tasks are one list, not Kanban columns, because columns are hard to read on a phone (Epic Decision 6), and screens stay compact vertical flows (Decision 10).

Today the API has users, sessions, projects and memberships, with per-field last-write-wins for projects (`apps/api/src/http/last-write-wins.ts`). No endpoint lists a project's members. On the phone, the write queue, storage, sync triggers and reconnect detection in `apps/mobile/src/sync/` are shared; the cache, refresh and outcome handling in `apps/mobile/src/projects/` are written for projects only. The app has no date picker. Inviting and managing members (#5) is being built in parallel in another session, and #5 includes a member list. This feature must not build its own copy of that: see requirement 8. Until #5 lands, a second member exists only through the database; the rules below apply to every member either way.

## Requirements

### Tasks and permissions

1. Titles and descriptions never contain control characters (a description may contain line breaks and tabs); the server refuses them and the phone removes them before saving, for tasks and for projects. (Added at Review.)
1a. A task belongs to exactly one project and has: a title (trimmed, 1 to 120 characters); a description (trimmed, may be empty, at most 2000 characters); a status, one of To do, Doing, Done, defaulting to To do; zero or more assignees; an optional due date; the person who created it; and when it was created.
2. A due date is a calendar day between the years 1900 and 9999, with an optional time of day (hours and minutes). It has no time zone: it means that day and time wherever the person reading it is (Decision 5 uses the device's time zone). A time can't be given without a day.
3. Anyone added as an assignee must be a member of the task's project at the moment the change is saved; a change that adds someone who isn't a member is refused as invalid. People already on the task are not re-checked, so a change can keep or remove them. A task has at most 20 assignees and lists each person at most once. When someone is removed from a project or leaves it, they are removed as an assignee from every task in that project at the same time. (Changed at Review.)
4. A task's id is chosen by the phone (a UUID) when it is created, so a task created offline keeps its id once it reaches the server. Creating is idempotent like projects: sending the same create again returns the existing task; using an id that already belongs to a task in another project, or a project the caller isn't in, is refused.
5. Any member of a project, Owner or Member, can create tasks in it, change any field of any task in it, and change any task's status.
6. Only the person who created a task, or an Owner of its project, can delete it. Anyone else gets a "not allowed" error. Deleting is permanent (hard delete).
7. A project holds at most 1000 tasks; creating one more is refused with a clear error, so the task list stays bounded. (Added at Review.) A signed-in member can read all tasks of a project they belong to, with every field above plus each assignee's id and display name.
8. A signed-in member can read the list of the project's members (id, display name, role), so the phone can offer assignees. Only members of the project can read it. **Depends on #5:** #5 also builds a member list. Before any work on reading members (API or phone), stop and ask the user whether #5 is done, and continue only after they approve. If #5's member list exists by then, use it rather than adding a second one; the plan must keep this part in its own task, so the rest of this feature can be built before it.
9. For a project the caller doesn't belong to, or one that doesn't exist, every task and member request gives the same "not found" error. A task id that doesn't exist, or belongs to another project, also gives "not found".
10. Every new endpoint requires a signed-in person and refuses a missing, unknown or expired session with the existing "not signed in" error, and all errors use the existing API error shape.
11. Deleting a project removes its tasks and their assignments. When a user's account is removed, their assignments are removed and tasks they created stay, with no creator; such a task can then be deleted only by an Owner.

### Conflicts (last-write-wins per field)

12. Each editable field — title, description, status, due date (day and time together), assignees (the whole set together) — carries the time the person changed it on the phone. The server accepts a change to a field only if that time is later than the stored time for the field, caps a time in the future at the server's current time, and judges fields separately, the same way projects do.
13. After any change request, the server responds with the task as it now is, whether or not each field was accepted.

### On the phone: reading and writing

14. The phone keeps a local copy of each project's task list. Opening the task list shows the local copy at once, then refreshes it from the server when online. A refresh replaces that project's copy with the server's list and reapplies changes still waiting to be sent; a task deleted elsewhere disappears at the next refresh.
15. Offline, the task list and task details stay visible from the local copy, with the existing offline note.
16. Creating, editing, changing status of, or deleting a task shows the result at once, online or offline, and records the change in the shared write queue, merged per task the same way project changes are (two edits leave one; create then edit leaves one create; create then delete leaves nothing).
17. Task changes are sent by the same triggers, in the same order and with the same retry, refusal, "not signed in" and sign-out handling as project changes. A refused task change is removed, the task is put back to the server's version (or removed if it no longer exists), and the person is told the change couldn't be saved.
18. A task change waiting for a project that is deleted, or that the person no longer belongs to, is dropped when the server refuses it, as in requirement 17; it never blocks the changes behind it.
19. Signing out removes every local task copy and the remembered filter choices along with the rest of the local data.
20. When the queue merges or sends task changes, the shared queue code gains no reference to tasks: the task kinds of change are registered from the tasks code, like projects.

### On the phone: screens

21. **Screens and how they connect.** Each move opens the next screen on top, and back (header control and swipe from the left edge) returns to the previous one, with no duplicate screens:
   - Project → the Tasks tile → Task list for that project. Near the top of the Project screen, above the collapsible details and not inside them, sits a grid of area tiles in two equal columns: Tasks (with the number of tasks not yet done), plus Ideas, Products and Fixed costs, which aren't built yet, look disabled, are labelled "Coming soon" and do nothing when tapped. Home is unchanged; there is no Tasks tile on Home. (Changed at the mockup review.)
   - Task list → "New task" → New task. Saving goes to the Task list with the new task in it; back from the list doesn't reach the filled-in form.
   - Task list → a task → Task (details). Task → "Edit" → Edit task; saving returns to Task with the saved values.
   - Task or Edit task → delete (only for the creator or an Owner) → confirm → Task list without that task; back doesn't reach the deleted task.
   - If the task being viewed disappears (deleted elsewhere, or its change refused with "not found"), the person is taken to the Task list, which shows the "couldn't be saved" notice when there was one.
22. **The list.** Each task is its own card showing its title, status, assignees (initials or names, at most three then "+n") and due date. Tasks not done are ordered by due date (overdue first, then soonest, then tasks with no due date), then by creation time. Done tasks sit in a "Done (n)" section at the bottom that starts closed.
23. **Changing status from the list.** A task's status can be changed from its card in one tap that offers the three statuses, without opening the task.
24. **Filters.** Above the list: a status filter (All, To do, Doing, Done) and three switches: "Assigned to me" (tasks where I'm one of the assignees), "Only me" (tasks where I'm the only assignee) and "Due soon". (Only me added at the mockup review.) They combine (all chosen conditions must hold). With a status other than All, the Done section isn't used and matching tasks show as one list. The choices are remembered per project on the phone until sign-out.
25. **Due soon** means the task isn't Done, has a due date, and its due moment is before the end of the day three days from today on the phone's clock (today plus the next three calendar days), including overdue tasks. A due date without a time counts as the end of that day. Overdue tasks are marked as overdue, in text as well as colour.
26. **Empty states.** A project with no tasks shows an invitation to create the first one. Filters that match nothing say so and offer to clear the filters.
27. **Forms.** New task and Edit task have title, description, status, assignees (picked from the project's current members, from the local copy when offline; someone already assigned who is no longer a member is shown so they can be removed, but can't be added again) and due date (pick a day, optionally add a time, and clear either). They validate the same limits as the server before saving, with a message per field. The return key moves title → description and the submit button is never hidden by the keyboard. A new task can be created with only a title. Deleting asks for confirmation naming the task and says it can't be undone, and the delete control sits apart from the submit button. (Changed at QA:) New task has no status field: a new task is always To do; Edit task shows the status choices. The due date and time are picked inside the field itself, which expands in place like a collapsible section and closes again, rather than a picker appearing below the field. A day or time in the past can't be picked when setting or changing a due date on the phone; a task whose due date has already passed keeps it and can still be saved.
28. **Look and language.** Screens follow `DESIGN.md` and Decision 10 (compact vertical flow, no tables), dates are shown in the app's language, and all text is available in Vietnamese and English.

### Data

29. A database migration adds tasks and task assignments, with the cascades in requirement 11. It applies to a database that already has users and projects.

## Acceptance Criteria

1. API tests: a title of 0 and 121 characters after trimming, a description of 2001 characters, and an unknown status are refused with `validation_failed`; a title of 120 characters, an empty description, each status and no due date are accepted; a new task without a status is To do.
2. API tests: a due date with a day and time, and with a day only, are stored and returned as given; a time without a day is refused with `validation_failed`.
3. API tests: assigning a project member works; adding a non-member, the same person twice, or 21 people is refused with `validation_failed`; a change that keeps an already-assigned former member, or removes them, is accepted; removing a member, and a member leaving, removes their assignments in that project only.
4. API tests: a task created with a phone-chosen UUID is returned with that id; the same create sent twice leaves one task; a create reusing another project's task id is refused and doesn't change that task.
5. API tests: a Member can create a task, edit every field of a task created by the Owner, and change its status.
6. API tests: the creator and an Owner can delete a task; a Member who didn't create it gets `403`; a second delete gives `404`.
7. API test: reading a project's tasks returns exactly that project's tasks with every field and assignees' display names.
8. API test: reading a project's members returns each member's id, display name and role.
9. API tests: task and member requests for a project the caller isn't in, a project that doesn't exist, and a task id from another project all give `404` with the same body.
10. API test: every new endpoint without a token, and with an expired one, gives `401 not_signed_in`.
11. API tests: deleting a project removes its tasks and assignments; deleting a user removes their assignments and leaves their created tasks with no creator, which a Member then can't delete and an Owner can.
12. API tests: an older change to `status` is ignored while a newer change to `title` in the same request is accepted; a change with a time one day in the future is stored with the server's current time; assignees are replaced as a whole set by the newer change.
13. API test: a fully ignored change returns `200` with the task's current values.
14. Test of the tasks sync layer: with a waiting rename of task A, a refresh returning the old title still shows the new title; a refresh without task B removes B.
15. By hand: open a project's tasks, turn on airplane mode, close and reopen the app: the task list and details show with the offline note.
16. Tests of the queue with task changes: two edits give one waiting change; create then edit give one create; create then delete give no request.
17. Tests of the tasks outcomes: a task change answered `403` or `404` is removed, the local copy shows the server's version (or no task), and the "couldn't be saved" message appears; a `401` keeps it queued. By hand: change status, create and delete a task in airplane mode, reconnect, and see the changes on a second phone or in the API.
18. Test: a waiting task change for a project the server answers `404` for is dropped and the next waiting change is still sent.
19. By hand: sign out and sign in as another person: no tasks or filter choices from the first person show.
20. Code check: the shared queue code has no reference to tasks; task kinds of change are registered from the tasks code.
21. By hand, following each move in requirement 21: the named screen opens; back by header and by swipe returns to where it was opened from; after creating, back doesn't reach the form; after deleting, back doesn't reach the deleted task. The Project screen shows the two-column tile grid above the details, with the Tasks tile's not-done count and the other three tiles disabled with "Coming soon" doing nothing when tapped; Home has no Tasks tile.
22. Unit test of the list ordering: overdue, due today, due later, no due date, then Done in its own group; tasks with the same due date ordered by creation time. By hand: the Done section starts closed and shows its count.
23. By hand: changing status from a card updates it at once and moves it to its new place in the list.
24. Unit tests of the filters: each status, "Assigned to me", "Only me" and "Due soon" alone and combined select the right tasks; a task assigned to me and someone else matches "Assigned to me" but not "Only me". By hand: the choices survive closing and reopening the app.
25. Unit tests of "due soon" with a fixed clock: a task due yesterday, today, and in three days counts; one due in four days, a Done task, and one with no due date don't; a day with no time counts until the end of that day. By hand: an overdue task says it is overdue in words.
26. By hand: a new project shows the invitation to create a task; filters matching nothing show the message and a way to clear them.
27. By hand: a task saves with a title only; an over-long title shows the field message without saving; the assignee picker lists the project's members, also offline; a due day can be set, a time added, and either cleared; return moves title → description and submit stays above the keyboard; a Member who didn't create the task sees no delete control; delete asks for confirmation naming the task.
28. By hand, in both languages: no untranslated text, dates read naturally in each language, and screens follow `DESIGN.md` and Decision 10.
29. The migration applies cleanly to an empty database and to one with existing users and projects.

## Out of Scope

- Checklists and colour labels (#7), comments (#8), photos (#9), reminders and push notifications (#10, #16).
- Inviting people and managing members (#5, built in parallel). Until it lands, a second member exists only through the database, for testing.
- A Tasks tile on Home, a task list across all projects, and Kanban or calendar views.
- Paging, searching and sorting choices on the task list, and incremental sync: the phone fetches a project's whole task list, which is expected to stay in the low hundreds. Soft delete and undo.
- Merging concurrent changes to assignees: the assignee set is one field, so two people changing it at once keep only the later set.
- Real-time updates from the server: others' changes appear at the next refresh.

## Open Questions

None.
