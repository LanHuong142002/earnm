# Tasks: Members can track tasks in a simple list

Spec: `.ourkit/specs/claude-ourkit-spec-6-block-check-e6ffdc.md`. Plan: `.ourkit/plans/claude-ourkit-spec-6-block-check-e6ffdc.md`. Read both before starting any task. The plan's Changes section is the design to follow. Requirement numbers (R) and acceptance criteria (AC) refer to the spec.

**Test setup:**
- API tests need `TEST_DATABASE_URL` in `apps/api/.env` (a local database whose name ends in `_test`). If it isn't set, `ourkit gate run test` reports `not-run`: report that as not run, never as passed, and never point tests at `DATABASE_URL`.
- Mobile tests are vitest on pure modules. Network failures are simulated with fake senders that throw `ApiError("network")`, never with real sockets.
- Mobile packages are installed with `npx expo install` from `apps/mobile`, and must be bundled in Expo Go.

**Ticket #5 (invites and members) is being built in parallel in another session.** Don't build any member-list endpoint or member picker outside task 10.

## Tasks

### 1. API schema, migration and test helper for tasks

In `apps/api`:

- In `prisma/schema.prisma`:
  - Add `enum TaskStatus { todo doing done }`.
  - Add the `Task` model:
    - `id String @id`, with no default;
    - `projectId` with a relation to `Project`, `onDelete: Cascade`, and `@@index([projectId])`;
    - `title`, `description String @default("")`, `status TaskStatus @default(todo)`, `dueDate DateTime? @db.Date`, `dueTime String?`;
    - `titleEditedAt`, `descriptionEditedAt`, `statusEditedAt`, `dueEditedAt`, `assigneesEditedAt` (all `DateTime`);
    - `createdById String?` with a relation to `User`, `onDelete: SetNull`;
    - `createdAt`, `updatedAt @updatedAt`, `assignees TaskAssignee[]`.
  - Add the `TaskAssignee` model: `taskId`, `userId`, `@@id([taskId, userId])`, `@@index([userId])`, with relations to `Task` and `User`, both `onDelete: Cascade`.
  - Add the back-relations on `User` (created tasks and assignments) and on `Project` (tasks).
- Create the migration with `npm --prefix apps/api run db:migrate -- --name tasks`. It must only add a type, tables, indexes and foreign keys. Commit it.
- In `src/test/helpers.ts`, add `addMember(projectId, userId, role)`, which inserts a `ProjectMember` row directly. Tasks are already emptied by the cascade from `"Project"` in the existing truncate. Check that this holds.
- Add `src/tasks/schema.test.ts` for R11, R29 and AC 11 (schema part):
  - deleting a project removes its tasks and assignee rows;
  - deleting a user removes their assignee rows and sets `createdById` to null on tasks they created;
  - the same `(taskId, userId)` pair can't be inserted twice.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass; the migration SQL has only `CREATE` statements and foreign keys.

### 2. API tasks router

Add `apps/api/src/tasks/routes.ts` exporting `createTasksRouter(deps: { prisma, now })`, built with `Router({ mergeParams: true })` and placed behind `requireAuth`. Mount it in `src/app.ts` at `/projects/:projectId/tasks`. Follow `src/projects/routes.ts`; export `findForMember` from there if needed, rather than copying it. Implement exactly the plan's API section:

- Every route first checks that `projectId` is a uuid and that the caller is a member, otherwise `404 not_found`. A `taskId` that isn't a uuid, or isn't in this project, also gives `404` with the same body (R9).
- The task shape is `{ id, projectId, title, description, status, dueDate: "YYYY-MM-DD"|null, dueTime: "HH:mm"|null, assignees: [{ id, displayName }], createdById, createdAt }`.
  - Serialise `dueDate` with `toISOString().slice(0, 10)` and parse it as UTC.
- `GET /` returns that project's tasks with their assignees, in one query.
- `POST /` creates a task: idempotent on `id`, `409 id_conflict` when the id is used in another project, all `*EditedAt` set to the clamped `editedAt`, `createdById` set to the caller, the assignee membership check inside the transaction, and one retry on P2002.
- `PATCH /:taskId` applies `{ fields: { title|description|status|due|assignees: { value, editedAt } } }` through `applyLastWriteWins`:
  - `due` writes `dueDate` and `dueTime`;
  - `assignees` claims `assigneesEditedAt` with `updateMany`; only when that matched one row, it checks membership, then replaces the rows;
  - a non-member assignee throws `400 validation_failed` and rolls the transaction back;
  - the response is always `200` with the task as it now is.
- `DELETE /:taskId`:
  - `403 forbidden` unless the caller created the task or is an Owner (a task with no creator: Owner only);
  - `204` on success, `404` when the task is already gone.
- Validation:
  - title is trimmed, 1–120 characters;
  - description is trimmed, at most 2000 characters;
  - status is one of the enum values;
  - `dueDate` is a real calendar date;
  - `dueTime` matches `HH:mm` (`00`–`23`, `00`–`59`) and is allowed only with a date;
  - `assigneeIds` are uuids, unique, at most 20;
  - schemas are strict, and a patch needs at least one field.

Add `src/tasks/routes.test.ts` for AC 1–7 and 9–13. Use `createSignedInUser`, `addMember` and `createClock`. Cover every route for the `401` cases and for the three `404` cases (non-member, missing project, a task from another project).

Depends on: 1
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 3. Per-entity result handlers in the shared queue

In `apps/mobile/src/sync/queue.ts`:
- Change `registerEntity(entity, senders)` to `registerEntity(entity, senders, handlers?)`, where `handlers` holds optional `onApplied`/`onRejected` with the same signatures as the queue-level ones.
- When a change is applied or rejected, call that entity's handler if it has one; otherwise call the queue-level handler.
- Projects keep registering without handlers, so they behave exactly as today.
- Add no reference to tasks in `src/sync/`.

Add tests in `src/sync/queue.test.ts`: a change for an entity with handlers reaches only those handlers; a project change still reaches the queue-level handlers. The existing tests must pass unchanged.

Depends on: none
Verify: `ourkit gate run test` passes; `grep -ri task apps/mobile/src/sync` finds nothing.

### 4. Pure task rules on the phone: due dates, filters, ordering, permissions, validation

Add, in `apps/mobile/src/tasks/`, React-free modules with vitest tests next to them. Define the `Task` type here, matching task 2's shape.

- `dueDate.ts`:
  - `isOverdue(task, now)` and `isDueSoon(task, now)`, for R25. A date without a time means the end of that day. "Due soon" means not Done and due before the end of the day three calendar days after today, in the phone's local time; overdue tasks count.
  - `formatDue(dueDate, dueTime, lang)` with weekday and month names from i18n keys, written by hand, without `Intl`. For example `T6, 14/11 · 14:30` in Vietnamese and `Fri, 14 Nov · 14:30` in English, with no time part when there is no time.
- `filters.ts`: `applyFilters(tasks, { status: "all"|"todo"|"doing"|"done", mine, dueSoon }, myId, now)`. The conditions combine (R24).
- `listOrder.ts`: `orderTasks(tasks, now)` returns `{ open, done }`, for R22. `open` is overdue first, then by due moment, then tasks with no due date, with creation time breaking ties.
- `permissions.ts`: `canDeleteTask(task, myId, myRole)`, for R6. A task with no creator can be deleted only by an Owner.
- `validate.ts`: `validateTaskInput`, with the server's limits, returning a message key per field (R27).
- Add to `src/i18n/en.json` and `vi.json` the `tasks.*` keys these need: weekday and month names, `overdue`, status names, and validation messages.

Tests cover AC 22, 24 and 25 (pure parts) and `canDeleteTask`. Use a fixed `now` and check: yesterday, today, +3 days and +4 days; a Done task; a task with no date; a date without a time; ties on the same due date.

Depends on: none
Verify: `ourkit gate run test` passes.

### 5. Tasks data layer on the phone

Add, in `apps/mobile/src/tasks/`, modelled on the matching files in `src/projects/` but specialised for tasks. Don't edit the projects files.

- `api.ts`: `listTasks(projectId)`, `createTask`, `patchTask`, `deleteTask`, over `lib/api` `request()`.
- `sync.ts`: `registerTaskEntity(queue, handlers)`.
  - It uses entity `"task"`, and each change's `data` includes `projectId`.
  - A create sends all fields with the latest field time; an update sends `{ value, editedAt }` per touched field (`title`, `description`, `status`, `due`, `assignees`).
- `store.ts`:
  - The cache `{ ownerId, byProject, filters }` under `tasks.cache.v1`, with load, save and clear. Load returns nothing when `ownerId` doesn't match the signed-in user, and the caller must act on that result.
  - `applyTaskOverlay(projectId, serverList, waitingChanges)`, for R14.
- `optimistic.ts`: `planTaskUpdate`, which sends only the touched fields, each with its own time.
- `outcomes.ts`:
  - applied: replace the cached task with the server's;
  - rejected with `404`: remove the task;
  - other rejections: mark that project for a refresh;
  - every rejection sets a notice `{ kind, taskTitle }` that uses `tasks.*` keys.
- `syncCycle.ts`: `refresh(projectId)` (list, then overlay, then save), injectable and React-free.

Tests, with `createMemoryStore` and `vi.fn` senders, cover:
- AC 14: the overlay keeps a waiting rename and drops a missing task;
- AC 16: merging task changes in the queue;
- AC 17 (automated part): `403`, `404` and `401` outcomes;
- AC 18: a `404` for a deleted project is dropped and the next waiting change is still sent;
- the cache owner check.

Depends on: 3, 4
Verify: `ourkit gate run test` passes.

### 6. TasksProvider and wiring

- `apps/mobile/src/projects/ProjectsProvider.tsx`: expose the existing queue instance and its after-enqueue flush through the context. Change nothing else there.
- Add `apps/mobile/src/tasks/TasksProvider.tsx`, rendered inside `ProjectsProvider` in `src/app/_layout.tsx`. It:
  - registers the `task` entity on the shared queue, with its own handlers;
  - loads the cache, acting on the owner check;
  - exposes, per project, the tasks, `create`, `update`, `setStatus`, `remove`, the filters and `setFilters` (persisted per project, R24), the rejected notice and `refresh(projectId)`;
  - updates the cache optimistically, then enqueues and flushes (R16);
  - registers a sign-out cleanup through `registerSignOutCleanup` that clears the task cache and filters (R19);
  - drops cached task lists for projects that are no longer in the project list.
- Use `newProjectId` (rename it or re-export it as a generic `newId` if that's cleaner) for task ids (R4).

Depends on: 3, 5
Verify: `ourkit gate run test` and `ourkit gate run lint` pass; the app starts in Expo Go with no new console errors (user check, Test Handoff).

### 7. Mockup of the task screens, approved by the user

Before any task screen is built, show the user a mockup in the project's look (DESIGN.md, real-looking Vietnamese and English content, no tables) of:
- the Project screen with its new Tasks row and not-done count;
- the Task list: the filter bar (status pills with a check on the selected one, "My tasks" and "Due soon" switches), task cards (title, status pill, assignee first names "+n", due date with "Overdue" in words), the closed "Done (n)" section, and both empty states;
- the Task details screen and the New/Edit task form (title, description, status, due date with an optional time, assignees, delete apart from the submit button).

Make changes until the user approves, then record the approved mockup's decisions under `## Approved mockup` at the end of the plan.

Depends on: none
Verify: the user approves the mockup (user check).

### 8. Task list screen, filters, status change and the Project screen entry

- Add the routes `src/app/(app)/(home)/projects/[id]/tasks/index.tsx` and register it in `(home)/_layout.tsx`.
- Build `TaskCard`, `FilterBar`, `StatusPicker` (`ActionSheetIOS` on iOS, `Alert` buttons otherwise) and `TaskRejectedNotice` in `src/tasks/`, following the approved mockup.
- The Task list:
  - uses `orderTasks` and `applyFilters`;
  - shows a "Done (n)" section in a `Collapsible` that starts closed, only when the status filter is All (R22, R24);
  - changes status in one tap from the card (R23);
  - shows the empty states, with a way to clear filters (R26);
  - shows `OfflineNote` (R15) and the rejected notice;
  - refreshes on focus (R14);
  - leads to `tasks/new` and to `tasks/[taskId]`;
  - navigates here whenever a viewed task disappears (R21).
- On `projects/[id]/index.tsx`, add the two-column area tile grid above the details, as in the plan's Approved mockup:
  - The Tasks tile shows the not-done count from the cache (no count when the project's tasks were never loaded), refreshes that project's tasks on focus, and pushes the Task list.
  - Ideas, Products and Fixed costs are disabled "Coming soon" tiles.
- Add `onlyMe` to `filters.ts` (tasks where I'm the only assignee), with tests, and add the three switches to the filter bar (R24).
- Add all new text to `en.json`/`vi.json`.

Depends on: 4, 6, 7
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. The user checks AC 21 (list moves), 23, 24 (remembered filters) and 26 in Expo Go, as part of the Test Handoff.

### 9. Task details, new and edit forms, due date picker, delete

- First check the Expo SDK 58 docs for `@expo/ui`'s date and time picker in Expo Go.
  - If it works there, use it.
  - Otherwise run `npx expo install @react-native-community/datetimepicker`.
  - Record which one was used in the plan's Approved mockup notes.
- Build `DueField` (pick a day, optionally add a time, clear either one) and `TaskForm` (title, description, status, due date; no assignee field until task 10).
  - It uses `validateTaskInput` and shows a message per field.
  - On the keyboard, return moves from title to description, and the submit button stays above the keyboard.
  - A task can be saved with only a title (R27).
- Add the routes `tasks/new.tsx`, `tasks/[taskId]/index.tsx` (details: every field, assignee names, due date with "Overdue" in words, Edit) and `tasks/[taskId]/edit.tsx`. Register them in `(home)/_layout.tsx`.
- Navigation follows R21 and the plan:
  - new: save, then `back()` to the list;
  - edit: save, then `back()` to the details;
  - delete (shown only when `canDeleteTask` allows it, set apart from the submit button, with a confirmation that names the task and says it can't be undone): `dismissTo` the list.
- Add all new text to `en.json`/`vi.json`.

Depends on: 4, 6, 7
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. The user checks AC 21 (the form, details and delete moves), 27 (except the assignee picker) and 28 in Expo Go, as part of the Test Handoff.

### 10. Member list and assignee picker (stop and ask about #5 first)

**Before doing anything in this task, stop and ask the user whether #5 is done, and wait for their approval.** Work only after they approve.

- **If #5's member list endpoint is on `main`:** merge or rebase onto it as the user directs. Use that endpoint, and check that it gives each member's id, display name and role. Don't add a second endpoint.
- **Otherwise, only if the user says to go ahead without it:** add `GET /projects/:projectId/members` in the tasks router area, returning `[{ id, displayName, role }]`. Members only; otherwise the same `404`. Add API tests for AC 8 and its `401`/`404` cases.
- **On the phone:**
  - add `listMembers(projectId)`;
  - cache the members per project in the tasks cache, so they work offline (R27);
  - add an assignee field to `TaskForm` using `ChoiceRow`s (selected shown with a check), with a limit of 20.

Depends on: 2, 9
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. The user checks the assignee picker online and offline in Expo Go (AC 27), as part of the Test Handoff.
