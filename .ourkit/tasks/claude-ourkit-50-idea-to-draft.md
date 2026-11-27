# Tasks: An accepted idea can become a drink draft (#50)

Spec: `.ourkit/specs/claude-ourkit-50-idea-to-draft.md`. Plan: `.ourkit/plans/claude-ourkit-50-idea-to-draft.md`. Mockup: `.ourkit/mockups/claude-ourkit-50-idea-to-draft.html`.

## Tasks

### 1. Schema: draft↔idea link and DraftPhoto

In `apps/api/prisma/schema.prisma`: add `Draft.ideaId String? @unique` with `idea Idea? @relation(fields: [ideaId], references: [id], onDelete: SetNull)`, back-relation `Idea.draft Draft?`. Add model `DraftPhoto` with the same columns and index as `IdeaPhoto` (`draftId` → `Draft` `onDelete: Cascade`, `addedById` → `User` `onDelete: SetNull`, `publicId @unique`), `Draft.photos DraftPhoto[]`, and the `User` back-relation. Write one additive migration in `apps/api/prisma/migrations/` with a timestamp after `20261125120000_activity` (nullable column, unique index, FK SET NULL, new table). Regenerate the Prisma client. Add `apps/api/src/drafts/schema.test.ts` checking the migration text: unique `ideaId`, `ON DELETE SET NULL` for the idea FK, `ON DELETE CASCADE` for `DraftPhoto.draftId`.

Depends on: none
Verify: `ourkit gate run build`, and the new schema test passes in `ourkit gate run test`

### 2. PhotoStore.copy

In `apps/api/src/photos/cloudinary.ts`, add `copy(sourcePublicId: string, targetPublicId: string): Promise<{ width: number; height: number }>` to `PhotoStore` and the real store: upload, with the Cloudinary SDK `uploader.upload`, a signed untransformed delivery URL of the authenticated source (`type: "authenticated"`, `sign_url: true`, no transformation), with `public_id: targetPublicId`, `type: "authenticated"`, `overwrite: false`, `resource_type: "image"`, and a 10 s timeout like destroy. Never log the secret or the signed URL. Add `copy` to every fake `PhotoStore` in API tests so they still type-check. Extend `photos/cloudinary.test.ts` to check the upload call's options with the SDK mocked as that test already does (no network).

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build`

### 3. Draft photos API

New `apps/api/src/drafts/photos.ts`, copied from `apps/api/src/ideas/photos.ts`: `GET /`, `POST /sign`, `POST /`, `PATCH /:photoId`, `DELETE /:photoId` under `/projects/:projectId/drafts/:draftId/photos`; public id `earnm/<projectId>/drafts/<draftId>/<photoId>` (export `draftPhotoPublicId`); 10 photos per draft, captions 200 characters; any member can sign and record; caption edit and delete only by the photo's `addedById` or a project Owner (403 otherwise); every write on a converted draft (`convertedAt` not null) → `409 draft_converted`; listing always allowed; `503 photos_unavailable` without a store. Mount in `apps/api/src/app.ts` next to the idea photos router. Tests in `drafts/photos.test.ts` mirroring `ideas/photos.test.ts`, plus the adder/Owner rule and `draft_converted` (spec AC 9–11).

Depends on: 1
Verify: `ourkit gate run test`

### 4. Draft and idea responses, and photo cleanup on delete

`apps/api/src/drafts/response.ts`: `draftInclude` adds `idea: { select: { id, title } }` and `_count: { select: { photos } }`; `draftResponse` adds `ideaId`, `idea` (`{id,title}|null`), `photoCount`. `apps/api/src/ideas/response.ts`: `ideaInclude` adds `draft: { select: { id, name, status, convertedAt } }`; `ideaResponse` adds `draftId` and `draft` (`{id,name,status,convertedAt}|null`). Update every place that builds these includes or types so it compiles. Draft delete in `drafts/routes.ts`: read the draft's photo public ids inside the transaction, destroy them after commit with `destroyImagesWithin` (as idea delete does). Project delete in `projects/routes.ts`: add draft photo public ids to the ids it already destroys. Tests: responses carry the new fields; deleting a draft destroys its photo images; deleting a project destroys draft photo images; deleting the idea leaves the draft with `ideaId: null`; deleting the draft makes the idea's `draft` null (spec AC 7, 12).

Depends on: 1, 2
Verify: `ourkit gate run test`

### 5. Create a draft from an idea endpoint

New `apps/api/src/ideas/toDraft.ts` mounted at `POST /projects/:projectId/ideas/:ideaId/draft`, built like `ideas/toTask.ts`. Body (strict): `draftId` uuid, `name` (draft name schema), `sizes` (draft sizes schema), `expectedPrice` optional, `note` optional. Step 1, one transaction under `lockedMember`: idea in project or 404; `accepted` or `409 idea_not_accepted`; no draft linked or `409 idea_already_has_draft`; draft id free or `409 id_conflict`; under the draft limit or `409 draft_limit_reached`; price range check as the draft create does; create the draft with `ideaId`. Map a Prisma unique violation on `ideaId` to `idea_already_has_draft`. Step 2, outside any transaction: copy each idea photo with `photoStore.copy` to `draftPhotoPublicId(projectId, draftId, newUuid)`, at most 3 at a time; count failures and timeouts; no store → every photo counts as not copied. Step 3, one transaction: if the draft still exists, create `DraftPhoto` rows (same width, height, caption, `addedById` = caller); if the draft is gone or this step throws, destroy the copied images, never any other id. Reply `201 { draft, idea, photosNotCopied }`. Tests in `ideas/toDraft.test.ts` with an injected fake store: happy path with 2 photos (new ids, same size and caption, idea photos untouched), each refusal code, each non-accepted status, concurrent requests (one 201, one `idea_already_has_draft`), one copy failing → `photosNotCopied: 1`, one copy hanging past the timeout, record step failing → copies destroyed, link kept after the idea's status changes (spec AC 1, 3, 4, 8, 13, 14).

Depends on: 2, 3, 4
Verify: `ourkit gate run test`

### 6. Mobile: types, API calls and draft photo parent

`apps/mobile/src/ideas/types.ts` and `apps/mobile/src/drafts/types.ts`: new fields (`draftId`, `draft` on Idea; `ideaId`, `idea`, `photoCount` on Draft), with defaults where cached data lacks them. `ideas/api.ts`: `createDraftFromIdea(projectId, ideaId, body)` (not queued). `drafts/api.ts` + `drafts/entities.ts`: draft photo calls and queue entity like idea photos. `tasks/parent.ts`: add `"draft"` to the kind union; new `drafts/adapters.ts` with `DRAFT_PHOTOS` scope and a `draftParent` whose `canManagePhotos` is true for the photo's adder or an Owner, and false for every photo once the draft is converted; adding photos allowed for any member unless converted. Unit tests for the adapter rules.

Depends on: none
Verify: `ourkit gate run test` (mobile) and `ourkit gate run lint`

### 7. Mobile: prefill and new draft from idea

New `apps/mobile/src/ideas/draftPrefill.ts` like `taskPrefill.ts`: name from the idea title cut to 60 characters at a word boundary when possible, note from description, `photoCount`, idea title; an error-code → i18n key map (`network`, `idea_not_accepted`, `idea_already_has_draft`, `draft_limit_reached`, fallback). `drafts/new.tsx`: with a `fromIdea` param, show the prefilled form (mockup B2: "Từ ý tưởng “…” · kèm N ảnh" line, 48pt thumbnails of the idea's photos), call `createDraftFromIdea` online, keep edits and show the message on failure (B2a, B2b, with "Mở nháp đó" replacing to the existing draft), on success insert the returned draft into the drafts store and cache without queuing (new method in `DraftsProvider.tsx`), update the idea in the ideas store, then `router.replace` to the draft passing `photosNotCopied`. Strings in `i18n/vi.json` and `en.json`. Unit tests for `draftPrefill`.

Depends on: 6
Verify: `ourkit gate run test` (mobile) and `ourkit gate run lint`

### 8. Mobile: idea and draft detail screens

Idea detail `app/(app)/(home)/projects/[id]/ideas/[ideaId]/index.tsx`: below the task action, "Tạo nháp món từ ý tưởng" button (mockup B1) when the idea is `accepted` and has no draft, pushing `drafts/new` with `fromIdea`; otherwise, when linked, a `LinkCard` "Đã tạo nháp món" with the draft name and status pushing the draft (B3). Draft detail `drafts/[draftId].tsx`: "Từ ý tưởng" `LinkCard` at the top pushing the idea (E1, below the product card when converted, E6); Photos section with the shared photo component and `draftParent` (E1, E3–E6); a grey dismissible notice "Không mang theo được N ảnh từ ý tưởng…" shown once when the `photosNotCopied` param is above 0 (E2), copying the `DraftRejectedNotice.tsx` pattern but with `field` background. Follow `DESIGN.md` values and the navigation map in the plan. Strings in both i18n files.

Depends on: 6, 7
Verify: `ourkit gate run test`, `ourkit gate run lint`; the screens themselves go to the Test Handoff (real phone)
