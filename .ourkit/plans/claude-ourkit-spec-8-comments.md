# Plan: Members can comment on tasks

Spec: `.ourkit/specs/claude-ourkit-spec-8-comments.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-8-comments.html` (approved).

## Approach

Comments become their own table and their own small API router under a task, built the same way as checklists: the phone picks the id, writes are idempotent, edits resolve last-write-wins per field with `<field>EditedAt`, and limits are counted under the project lock. Unlike checklists, comments are **not** embedded in the task list response. The task screen fetches one task's comments from `GET .../tasks/:taskId/comments`, caches them per task, and lays queued changes over them. Paging ("5 at a time", newest or oldest first) happens on the phone, over that one cached list, which the 500-per-task cap keeps small. This keeps the task list payload unchanged and keeps offline reads simple.

Permissions are checked on the server: membership for everything, author-only for text edits and deletes, and "involved" (creator or assignee, read inside the same transaction) for the "Nhắc kèm" flag. The phone mirrors those rules only to decide what to show.

## Prior Art

- Reuse `applyLastWriteWins` (`apps/api/src/http/last-write-wins.ts`) for `text` and `remindWith`.
- Reuse `findForMember`, `lockProject` (`apps/api/src/projects/access.ts`) and the `requireTask` / `lockedMember` / `withRetry` pattern from `apps/api/src/checklists/routes.ts`. Copy the pattern into the new router rather than refactoring checklists, to keep this change small.
- Reuse `multiLineText` from `apps/api/src/http/text.ts` for the 1000-character text.
- Reuse the phone queue (`apps/mobile/src/sync/queue.ts`, `registerEntity`) as a new `comment` entity, like `registerChecklistEntities` in `apps/mobile/src/tasks/sync.ts`; it already merges create+delete and update+update per id.
- Reuse `newId` (`expo-crypto` UUID), `Avatar`, `Button`, `ErrorText`, `PressableScale`, `TextLink` from `apps/mobile/src/ui`, and the date formatting in `apps/mobile/src/tasks/dueDate.ts` for comment times.
- Nothing in the project or its libraries handles comments, an "involved" check or per-task paging today, so those are new, written small.

## Changes

**Database** (`apps/api/prisma/schema.prisma`, new migration)
- `TaskComment`: `id` (client UUID), `taskId` (cascade on task delete), `authorId` (nullable, set null if the user is deleted), `text`, `textEditedAt`, `edited` (boolean, default false), `remindWith` (boolean, default false), `remindWithEditedAt`, `createdAt`. Index on `(taskId, createdAt, id)`. Every new NOT NULL column has a default that stays (lesson on migrations running before the new server).

**API** (`apps/api/src/comments/routes.ts`, mounted under `/projects/:projectId/tasks/:taskId/comments` in `apps/api/src/app.ts`)
- `GET /`: member only (404 otherwise); returns all comments of the task, ordered by `createdAt, id`, with `author {id, displayName} | null`, `text`, `edited`, `remindWith`, `createdAt`.
- `POST /`: body `{id, text, remindWith?}` (strict zod). Under the project lock: member check, 500-per-task count (`comment_limit_reached`), and if `remindWith` is true, the involved check (403). Same id on the same task returns the existing comment with 200; on another task, 409 `id_conflict`.
- `PATCH /:commentId`: body `{text?: {value, editedAt}, remindWith?: {value, editedAt}}`. `text` needs the author (403), `remindWith` needs an involved person (403). Applies last-write-wins; a text write that wins also sets `edited = true`. Missing comment: 404.
- `DELETE /:commentId`: author only (403), 404 if missing.
- `apps/api/src/tasks/involved.ts`: `isInvolved(tx, task, userId)`: `task.createdById === userId` or an assignee row exists.

**Phone**
- `apps/mobile/src/tasks/comments/`: `types.ts`, `api.ts` (list, create, patch, delete), `store.ts` (per-owner, per-task cache in AsyncStorage, pruned when the task disappears), `overlay.ts` (lay queued changes over the cached list, marking waiting and failed ones), `view.ts` (pure: sort, batch of 5, "load more" count, `edited`, `canEdit`, bell state per viewer, 1000-character check), `sync.ts` (register the `comment` entity; a permanent refusal keeps the change as **failed** in the store with retry/discard instead of the task-wide notice).
- `apps/mobile/src/tasks/permissions.ts`: add `isInvolved(task, userId)` and `canEditComment`.
- `apps/mobile/src/tasks/comments/useTaskComments.ts`: loads cache, fetches on open and after each sync pass, exposes add/edit/delete/toggle, the sort preference (AsyncStorage, per device) and the batch count.
- Components: `CommentsSection.tsx` (header with count and sort menu, write field at top, list, "Xem thêm", "Đã xem hết", empty state), `CommentBubble.tsx` (bubble, meta line with time / "đã sửa" / "Chờ gửi" / "Không gửi được" + Thử lại · Bỏ / Sửa · Xoá, inline edit with Huỷ · Lưu), `CommentBell.tsx` (three states from the mockup), `CommentComposer.tsx` (multi-line field kept above the keyboard, "Nhắc kèm" toggle for involved people only, send button, over-length message).
- Task screen `apps/mobile/src/app/(app)/(home)/projects/[id]/tasks/[taskId]/index.tsx`: add the section after Checklist (mockup 1a–1e, 2a–2d, 3a–3d).
- `apps/mobile/src/i18n/vi.json`, `en.json`: `tasks.comments.*` keys, kept in parity.

## Risks

- **Sensitive Areas: data, schema, api.** A wrong permission check would let people edit others' comments or set flags they shouldn't. Every rule gets an API test for allowed and refused callers, including Owners.
- Involved status changes while a flag change is queued offline: the server decides at send time; a refusal shows "Không gửi được" on that comment.
- #9 also adds a migration. This one merges first; #9's migration must get a later timestamp (lesson).
- Fetching per task means a task opened for the first time offline shows no comments. The section then says it's offline rather than "no comments".
- The inline write field and inline edit must stay above the keyboard inside the task screen's scroll view; the screen already uses `keyboardOffset`. Checked by hand.
- A removed member keeps their comments (spec R6/R10) and loses all access, which membership checks already enforce.

## Test Strategy

- `ourkit gate run test` (API suite on a real test Postgres, then mobile `tsc` + vitest), `ourkit gate run lint`, `ourkit gate run build`.
- API tests (new `apps/api/src/comments/routes.test.ts`): R1–R13 / AC1–13, including 401, 404 for non-members, 403 for non-authors and Owners, 403 for non-involved flagging, idempotent create and 409, the 500 cap, last-write-wins on both fields, cascade on task delete, and a flag staying after the assignee is removed.
- Mobile unit tests: `view.ts` (sort, batches, bell states, edited, length check), `overlay.ts` (waiting and failed states, queued create/edit/delete/flag), `sync.ts` (queue merge per comment, failed change kept with retry/discard), `permissions.ts`, author-null neutral name, i18n parity.
- Migration: applied by the test suite's `prisma migrate deploy` on an empty database; applying over existing data is checked with the dev database before phone QA.
- Test Handoff (by hand on the phone, against the mockup): section placement and batches, sort remembered after restart, bell states as involved and non-involved, inline edit and delete, offline send with "Chờ gửi", a refused send, light/dark, VI/EN, VoiceOver names.
