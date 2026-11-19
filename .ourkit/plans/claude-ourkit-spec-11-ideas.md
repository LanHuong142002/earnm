# Plan: Members can collect, discuss and vote on ideas (#11)

Spec: `.ourkit/specs/claude-ourkit-spec-11-ideas.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-11-ideas.html` (approved 2026-11-18).

## Approach

Ideas are a new project child resource built like tasks, with sub-resources built like task comments and photos. On the API: new Prisma models and routers under `/projects/:projectId/ideas`, reusing `lockProject`, `applyLastWriteWins`, text helpers, the `Label` table and the Cloudinary store (`photos/cloudinary.ts`, `destroy.ts`) with an `earnm/<project>/ideas/<idea>/<photo>` public-id prefix. A dedicated `POST /ideas/:ideaId/task` creates the task server-side (title, description, labels, no photos) and sets the link, in one transaction. On the phone: an `ideas/` folder mirroring `tasks/` (store, queue entity, sync cycle, overlay), list and detail screens copied from the task list and task screen, and comments/photos components lifted to take a generic parent rather than duplicated where that is a small, safe change.

## Prior Art

- **In project, reuse:** task routes/LWW/idempotent create; comments routes (copy, minus remindWith); photos sign/record/delete and `destroyImages`; label validation; mobile `sync/queue.ts`, `syncCycle.ts`, `FilterBar`, `Collapsible`, `TaskCard` layout, `OfflineNote`, `SheetFrame`, status picker sheet, `PhotosSection`/`PhotoViewer`/`CaptionSheet`, `CommentsSection`/`CommentBubble`/`CommentComposer`.
- **Mobile comments/photos components:** refactor to take a `parent` adapter (api/store/sync + permission callbacks) instead of `taskId`, keeping task behaviour identical (existing tests must stay green). Cheaper and more consistent than copying ~12 files each. If the refactor grows beyond the hooks, fall back to copying for photos only (decision at Build, logged).
- **Image copy:** not needed; copying photos to the task was moved to #43 by the user.
- **Votes:** no library; a `(ideaId, userId)` table with value ±1.

## Changes

**API (`apps/api`)**
- `prisma/schema.prisma` + one migration: `Idea` (id, projectId cascade, authorId SetNull, title, description, status enum `new|considering|accepted|dropped`, per-field `*EditedAt`, createdAt, `taskId` unique nullable → Task SetNull), `IdeaLabel`, `IdeaVote` (PK ideaId+userId, value smallint), `IdeaComment`, `IdeaPhoto`. Timestamp checked against `main` and #10's migration at Build and again before Ship (lesson).
- `src/ideas/routes.ts` (list with score + own vote + counts, create, patch, delete), `votes.ts` (`PUT /:ideaId/vote {value: 1|-1|0}`), `comments.ts`, `photos.ts`, `toTask.ts`. Limits: `MAX_IDEAS_PER_PROJECT=500`, `MAX_COMMENTS_PER_IDEA=500`, `MAX_PHOTOS_PER_IDEA=10`.
- Project delete path and idea delete: collect idea photo public ids and destroy (every cascade path, lesson). Task routes: task response gains `fromIdeaId`.
- `src/app.ts` mount.

**Mobile (`apps/mobile`)**
- `src/ideas/`: types, api, store, sync, syncCycle handlers, overlay, `order.ts`, `filters.ts`, `counts.ts`, `permissions.ts`, `IdeasProvider.tsx` (wired next to `TasksProvider`).
- Routes `projects/[id]/ideas/index.tsx` (mockup 1b–1d, 3c, 3d), `new.tsx` (3a), `[ideaId]/index.tsx` (2a, 2c, 2e), `[ideaId]/edit.tsx` (3b), status sheet (2b).
- Project screen tile enabled with count (1a). Home screen's non-project Ideas tile stays as is.
- `tasks/new.tsx`: accept `fromIdea` param → prefilled form + note (2d); save calls the to-task endpoint, then `router.replace` to the task.
- Task screen: "Từ ý tưởng" link.
- `tasks/comments/*`, `tasks/photos/*`: generic parent refactor; `remindWith` bell hidden when the parent has no reminders.
- `i18n` VI/EN.

## Risks

- **Sensitive Areas: data, schema, public API.** New tables and endpoints with membership checks; members-only signed image URLs; author/Owner checks on edits and photos.
- **Refactoring #8/#9 components** could regress tasks: existing unit tests must pass unchanged; by-hand recheck of task comments and photos goes into the Test Handoff.
- **Migration ordering with #10** (both add migrations): whichever merges second renames its migration timestamp.
- **Score sort with pending local votes:** overlay applies own pending vote to score before sorting.

## Test Strategy

Commands: `ourkit command test`, `ourkit command lint`.
- API tests (real test DB, Cloudinary store faked): R1–R11, R13, R14, R24.
- Unit tests (mobile): order and filters R17, New count R16, permissions R2/R19, queue merge R22, button state R15, author fallback R6.
- Existing #8/#9 tests guard the refactor.
- Test Handoff (phone): R12, R16–R23 screens against the mockup, task comments/photos regression check.
- Cloudinary failures are tested only through the injected fake store (decided now).
