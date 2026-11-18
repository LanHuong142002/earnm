# Tasks: Members can comment on tasks

Spec: `.ourkit/specs/claude-ourkit-spec-8-comments.md`. Plan: `.ourkit/plans/claude-ourkit-spec-8-comments.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-8-comments.html`.

**API contract shared by tasks 1–3** (base `/projects/:projectId/tasks/:taskId/comments`, all need sign-in, non-members get 404 `not_found`):

- Comment JSON: `{ id, taskId, author: { id, displayName } | null, text, edited, remindWith, createdAt }` (ISO times).
- `GET /` → `{ comments: Comment[] }` ordered by `createdAt` then `id`, ascending.
- `POST /` body `{ id: uuid, text: string, remindWith?: boolean }` (strict) → 201 Comment, or 200 with the existing comment for the same id on the same task; 409 `id_conflict` for an id used on another task; 403 `forbidden` when `remindWith` is true and the caller isn't involved; 409 `comment_limit_reached` at 500 comments; 400 `validation_failed` for text that is empty after trimming or over 1000 characters.
- `PATCH /:commentId` body `{ text?: { value, editedAt }, remindWith?: { value, editedAt } }` (strict, at least one) → 200 current Comment. `text` needs the author, `remindWith` needs an involved person (403 `forbidden`). Last-write-wins per field; a winning text write sets `edited = true`. 404 if the comment is gone.
- `DELETE /:commentId` → 204; author only (403); 404 if gone.
- Involved = `task.createdById === userId` or the user is an assignee of the task.

## Tasks

### 1. Comments table and API

Add the `TaskComment` model to `apps/api/prisma/schema.prisma` (`id` String @id, `taskId` → Task onDelete Cascade, `authorId` → User nullable onDelete SetNull, `text`, `textEditedAt` DateTime @default(now()), `edited` Boolean @default(false), `remindWith` Boolean @default(false), `remindWithEditedAt` DateTime @default(now()), `createdAt` @default(now()), `@@index([taskId, createdAt, id])`) and generate a migration with a new timestamped folder. Keep every default (migrations run before the new server starts).

Add `apps/api/src/tasks/involved.ts` with `isInvolved(tx, task, userId)`. Add `apps/api/src/comments/routes.ts` implementing the contract above, following the pattern of `apps/api/src/checklists/routes.ts` (requireTask, project lock via `lockProject`, `withRetry`, zod 4 strict bodies, `applyLastWriteWins` from `apps/api/src/http/last-write-wins.ts`, editedAt clamped to server time, trimming via `apps/api/src/http/text.ts`). Mount it in `apps/api/src/app.ts` the way the checklist router is mounted. Add `apps/api/src/comments/routes.test.ts` covering spec AC1–13: 401, non-member 404, author-only edit/delete (another member and an Owner get 403), involved-only flag on create and patch (creator and assignee allowed, other member 403), flag kept after the assignee is removed, edited flag only on text change, idempotent create and 409, the 500 cap, last-write-wins on both fields, 404 on a deleted comment, cascade on task delete, author null after the user is deleted.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass; the new route tests pass.

### 2. Phone data layer for comments

In `apps/mobile/src/tasks/comments/` add: `types.ts` (Comment as in the contract, plus local `state: 'synced' | 'waiting' | 'failed'`), `api.ts` (list, create, patch, delete through `apps/mobile/src/lib/api.ts`), `store.ts` (per-owner, per-task cache in the existing KeyValueStore / AsyncStorage, pruned with the task cache), `overlay.ts` (lay queued and failed changes over the cached list: queued create → waiting comment, queued edit/flag → new value, queued delete → hidden, failed → `failed`), `sync.ts` (register a `comment` entity on the queue in `apps/mobile/src/sync/queue.ts` via `registerEntity`, alongside `registerChecklistEntities` in `apps/mobile/src/tasks/sync.ts`; text and remindWith go as separate fields of an update so they merge per field; a permanent refusal keeps the change in a failed list in the store with retry (re-enqueue) and discard (drop) instead of the task-wide `TaskRejectedNotice`), `view.ts` (pure: sort newest/oldest, batch of 5 with `shown` count and `remaining`, `edited`, `canEdit` for the author, bell state `on | off-tappable | on-readonly | hidden` per viewer, involved check, 1000-character check returning how many to remove, neutral author name when `author` is null), and `useTaskComments.ts` (loads cache, fetches on open and after each sync pass, add/edit/delete/toggle with `newId`, sort preference stored per device, `loadMore`). Add `isInvolved(task, userId)` and `canEditComment(comment, userId)` to `apps/mobile/src/tasks/permissions.ts`. Unit tests next to each pure module (`view.test.ts`, `overlay.test.ts`, `sync.test.ts`, `permissions.test.ts`), following existing tests such as `checklistSync.test.ts` and `checklistOverlay.test.ts`.

Depends on: none
Verify: `ourkit gate run test` (mobile `tsc` + vitest) and `ourkit gate run lint` pass.

### 3. Comments section on the task screen

Build the UI from the mockup (`.ourkit/mockups/claude-ourkit-spec-8-comments.html`, sections 1–3) in `apps/mobile/src/tasks/comments/`: `CommentsSection.tsx` (heading "Bình luận" with count, "Mới nhất ⌄" sort menu, write field at the top, list with 16pt gaps, "Xem thêm bình luận (N)", "Đã xem hết bình luận", empty state, offline note when nothing is cached), `CommentBubble.tsx` (avatar initial, bubble in `field` colour with name and text, meta line with time from the date helpers in `apps/mobile/src/tasks/dueDate.ts`, "đã sửa", "Chờ gửi" with clock icon, "Không gửi được" with Thử lại · Bỏ, "Sửa · Xoá" for one's own; inline edit with Huỷ · Lưu; delete confirm alert), `CommentBell.tsx` (states from `view.ts`, 44pt target, accessible label), `CommentComposer.tsx` (multi-line, stays above the keyboard, "Nhắc kèm" toggle only for involved people and reset after send, send disabled when empty or over 1000 with the red message). Insert the section in `apps/mobile/src/app/(app)/(home)/projects/[id]/tasks/[taskId]/index.tsx` after the Checklist section and before the delete button, inside the existing `Enter` sequence. Use only `DESIGN.md` tokens from `apps/mobile/src/theme` and components from `apps/mobile/src/ui`. Add `tasks.comments.*` keys to `apps/mobile/src/i18n/vi.json` and `en.json` (parity test must pass).

Depends on: 2
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. Looking at it on the phone against the mockup is a Test Handoff for the user.
