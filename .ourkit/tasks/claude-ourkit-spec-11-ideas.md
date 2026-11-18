# Tasks: Members can collect, discuss and vote on ideas

Spec: `.ourkit/specs/claude-ourkit-spec-11-ideas.md`. Plan: `.ourkit/plans/claude-ourkit-spec-11-ideas.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-11-ideas.html`.

**API contract** (base `/projects/:projectId/ideas`, sign-in required, non-members 404 `not_found`):
- Idea JSON: `{ id, projectId, author: { id, displayName } | null, title, description, status: "new"|"considering"|"accepted"|"dropped", labelIds, score, myVote: -1|0|1, commentCount, photoCount, taskId: string|null, task: { id, title, status } | null, createdAt }`.
- `GET /` → `{ ideas: Idea[] }`. `GET /:ideaId` → Idea.
- `POST /` `{ id: uuid, title, description?, labelIds? }` (strict) → 201 (status new), 200 for the same id in the same project, 409 `id_conflict` elsewhere, 409 `idea_limit_reached` at 500, 400 `validation_failed` (title 1–120 trimmed, description ≤2000, ≤10 labels, labels from this project).
- `PATCH /:ideaId` `{ title?, description?, labels?, status? }` each `{ value, editedAt }`; LWW per field. title/description/labels: author or project Owner (else 403 `forbidden`); status: any member.
- `DELETE /:ideaId` → 204; author or Owner; destroys idea photo images after the response.
- `PUT /:ideaId/vote` `{ value: -1|0|1 }` → 200 Idea (0 removes the vote).
- Comments: `/:ideaId/comments` — same contract as task comments (`apps/api/src/comments/routes.ts`) without `remindWith`; author-only edit/delete; `MAX_COMMENTS_PER_IDEA = 500`.
- Photos: `/:ideaId/photos` — same contract as task photos (`apps/api/src/photos/routes.ts`: `POST /sign`, `POST /`, `GET /`, `PATCH /:photoId` caption, `DELETE /:photoId`), public id `earnm/<projectId>/ideas/<ideaId>/<photoId>`, `MAX_PHOTOS_PER_IDEA = 10`; sign/record/delete need author or Owner.
- `POST /:ideaId/task` `{ taskId: uuid }` → 201 `{ task, idea }`: idea must be accepted (409 `idea_not_accepted`) and not linked (409 `idea_already_has_task`); creates the task (title, description, labels; createdBy caller; status todo) and sets `Idea.taskId`, in one transaction, within the project task limit. No photos (#43).
- Task JSON gains `fromIdea: { id, title } | null`.

## Tasks

### 1. Ideas tables, core API and votes

In `apps/api/prisma/schema.prisma` add `IdeaStatus` enum, `Idea` (id @id, projectId → Project cascade, authorId → User? SetNull, title, description @default(""), status @default(new), titleEditedAt, descriptionEditedAt, statusEditedAt, labelsEditedAt (all @default(now())), taskId String? @unique → Task SetNull, createdAt, `@@index([projectId, createdAt])`), `IdeaLabel` (ideaId, labelId, both cascade, `@@id`), `IdeaVote` (ideaId cascade, userId → User cascade, value Int, `@@id([ideaId, userId])`), `IdeaComment` (as `TaskComment` minus remindWith fields, ideaId cascade), `IdeaPhoto` (as `TaskPhoto`, ideaId cascade). One migration folder `20261118130000_ideas` (all NOT NULL columns with defaults). Add `apps/api/src/ideas/routes.ts` and `votes.ts` per the contract (patterns: `apps/api/src/tasks/routes.ts`, `lockProject`, `withRetry`, `applyLastWriteWins`, `apps/api/src/http/text.ts`), mount in `apps/api/src/app.ts`. Idea delete and project delete (`apps/api/src/projects/routes.ts`) collect `IdeaPhoto.publicId`s and call `destroyImages` after commit, alongside task photos. Tests `apps/api/src/ideas/routes.test.ts` for spec AC1–9, 24 (image store faked as in the photo tests).

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 2. Idea comments API

`apps/api/src/ideas/comments.ts` copying `apps/api/src/comments/routes.ts` without `remindWith`, mounted under ideas. Tests for spec AC10 (create, edited flag, author-only edit/delete, 500 cap, idempotent create, LWW, 404 for non-members, no `remindWith` field in responses).

Depends on: 1
Verify: `ourkit gate run test` passes.

### 3. Idea photos API

`apps/api/src/ideas/photos.ts` copying `apps/api/src/photos/routes.ts` with the idea public-id prefix, author/Owner checks for sign, record and delete, members-only list with signed URLs, `MAX_PHOTOS_PER_IDEA`. Reuse `apps/api/src/photos/cloudinary.ts` and `destroy.ts`. Tests for spec AC11 with the faked store.

Depends on: 1
Verify: `ourkit gate run test` passes.

### 4. Create task from idea

`apps/api/src/ideas/toTask.ts` implementing `POST /:ideaId/task` per the contract; task responses in `apps/api/src/tasks/routes.ts` include `fromIdea`. Deleting the task clears `Idea.taskId` (SetNull) and deleting the idea removes the back-link. Tests for spec AC13 and AC14 (accepted only, once only, labels copied, no photos, both links, task limit respected).

Depends on: 1
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 5. Make the phone's comments and photos components parent-agnostic

Refactor `apps/mobile/src/tasks/comments/` and `apps/mobile/src/tasks/photos/` so hooks and components take a `parent` adapter (`{ kind: "task"|"idea", projectId, id, api, store keys, queue entity names, canFlag?: boolean, canManagePhotos: boolean }`) instead of a task id; task behaviour stays identical (bell only when `canFlag`). No new idea code beyond the adapter type. All existing tests must pass unchanged.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run lint` pass with no existing test edited except imports.

### 6. Phone ideas data layer

`apps/mobile/src/ideas/`: `types.ts`, `api.ts`, `store.ts` (per-owner cache), `sync.ts` (queue entities `idea`, `ideaVote`; title/description/status/labels as separate fields), `syncCycle` handlers and refresh wired like tasks, `overlay.ts` (pending vote adjusts score and myVote), `order.ts` (score desc, then newest; dropped separate), `filters.ts` (status and label), `counts.ts` (New count), `permissions.ts` (author or Owner edits), `IdeasProvider.tsx` wired next to `TasksProvider` in `apps/mobile/src/app/_layout.tsx`. Idea comment and photo adapters for task 5's components. Unit tests for spec AC6 (neutral author), 15 (offline create-task button state), 16, 17, 22.

Depends on: 1, 5
Verify: `ourkit gate run test` and `ourkit gate run lint` pass.

### 7. Ideas screens

From the mockup (sections 1–3): project screen Ý tưởng tile enabled with New count (`apps/mobile/src/app/(app)/(home)/projects/[id]/index.tsx`); routes `projects/[id]/ideas/index.tsx` (filters, rows with vote control, collapsed Đã bỏ, empty, skeleton, error card, offline note), `ideas/new.tsx` and `ideas/[ideaId]/edit.tsx` (form with title, description, labels, photos; delete confirm for author/Owner), `ideas/[ideaId]/index.tsx` (info card with status sheet, big vote buttons, create-task button or created-task link or "Cần có mạng" note, Ảnh and Bình luận via task 5's components without the bell). Selections by highlight only; the "Đã chọn" pill keeps its check icon. Navigation per the spec's map. `DESIGN.md` tokens; `ideas.*` keys in `vi.json`/`en.json`.

Depends on: 6
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. Looking at it on the phone is a Test Handoff.

### 8. Prefilled task form and back-link

`apps/mobile/src/app/(app)/(home)/projects/[id]/tasks/new.tsx` accepts `fromIdea` (idea id): prefills title and description from the cached idea, shows labels read-only and the line "Từ ý tưởng “…”", and saving calls `POST /ideas/:ideaId/task` (network required), then `router.replace` to the new task. The task screen shows "Từ ý tưởng …" linking to the idea when `fromIdea` is set. Unit test for building the prefilled form.

Depends on: 6, 7
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. The flow on the phone is a Test Handoff.
