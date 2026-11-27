# Plan: An accepted idea can become a drink draft (#50)

Spec: `.ourkit/specs/claude-ourkit-50-idea-to-draft.md`. Mockup (approved): `.ourkit/mockups/claude-ourkit-50-idea-to-draft.html`.

## Approach

Store the link on the draft: `Draft.ideaId String? @unique`, relation to `Idea` with `onDelete: SetNull`. One column gives "at most one draft per idea" (unique), clears itself when the idea is deleted (R9), and disappears with the draft when the draft is deleted (R9), so neither delete path needs new link code.

Add a `DraftPhoto` model and a draft photos router copied from the idea photos router (the newer of the two), with the draft rules: any member adds, the adder or an Owner edits and deletes (D1), and every write is refused once the draft is converted (R13).

Add `POST /projects/:projectId/ideas/:ideaId/draft` in a new `ideas/toDraft.ts`, built like `ideas/toTask.ts`. It runs in three steps so no Cloudinary call happens inside a database transaction:
1. Transaction under the project lock: check the idea (in project, `accepted`, no draft), the draft id and the draft limit, then create the draft with `ideaId` set. A unique-violation on `ideaId` from a concurrent request maps to `idea_already_has_draft` (R4).
2. Outside the transaction: copy each idea photo to a new public id `earnm/<projectId>/drafts/<draftId>/<newPhotoId>` with a new `PhotoStore.copy`, at most 3 at a time, each with a timeout. Failures are counted, not thrown (D2, R16).
3. Transaction: record a `DraftPhoto` row for each successful copy (same width, height, caption; `addedById` = caller). If this step fails, or the draft no longer exists, destroy the copied images (R17), then reply.

The reply is `201 { draft, idea, photosNotCopied }`. Creating is online only (R5): the phone calls the endpoint directly, as it does for `/task`, and on success puts the draft into the drafts store so the detail screen opens with it.

## Prior Art

- `ideas/toTask.ts` + `ideas/taskPrefill.ts` + `tasks/new.tsx` (`fromIdea` param): the same flow for tasks. **Reuse the pattern**: copy the endpoint shape, error codes and the prefill/route-param approach; write new files for drafts because the bodies differ.
- `ideas/photos.ts` (idea photo router) and `photos/routes.ts` (task): two copies, no shared factory. **Copy the idea router** into `drafts/photos.ts`; extracting a shared factory now would touch two working Sensitive-Area routers for no requirement, so not in this change.
- `photos/cloudinary.ts` `PhotoStore`: has no copy. **Extend it** with `copy(sourcePublicId, targetPublicId): Promise<{ width; height }>`, using the Cloudinary SDK's `uploader.upload` with a signed, untransformed delivery URL of the authenticated source as the file, `type: "authenticated"`, `overwrite: false`, and the target public id. All tests use fake stores, so no test touches the network.
- `photos/destroy.ts` `destroyImages` / `destroyImagesWithin`: **reuse** for draft delete, project delete and R17 cleanup.
- Mobile: shared photo components take a `Parent` with `kind: "task" | "idea"` (`tasks/parent.ts`), idea photos plug in through `ideas/adapters.ts` with `IDEA_PHOTOS`. **Reuse**: add a `"draft"` kind and `DRAFT_PHOTOS` scope, no new photo UI.
- Mobile `drafts/LinkCard.tsx` (draft → product card): **reuse** for "Từ ý tưởng" on the draft and "Đã tạo nháp món" on the idea. `drafts/DraftRejectedNotice.tsx`: **copy** its pattern for the grey dismissible "Không mang theo được N ảnh" notice (no generic notice exists in `ui/`).

## Changes

**Schema (`apps/api/prisma`)**
- `Draft`: add `ideaId String? @unique`, `idea Idea? @relation(fields: [ideaId], references: [id], onDelete: SetNull)`. `Idea`: add back-relation `draft Draft?`.
- New `DraftPhoto` model, same columns and index as `IdeaPhoto`, `draftId` with `onDelete: Cascade`; `Draft.photos DraftPhoto[]`; `User` back-relation for `addedBy`.
- One migration, timestamped after `20261125120000_activity`. Additive only (nullable column, new table), so the running server keeps working while it deploys.

**API (`apps/api/src`)**
- `photos/cloudinary.ts`: `copy` on `PhotoStore` and the real store (R15).
- `drafts/photos.ts` (new): `GET /`, `POST /sign`, `POST /`, `PATCH /:photoId`, `DELETE /:photoId` under `/projects/:projectId/drafts/:draftId/photos`, limits 10 photos and 200-character captions, `draft_converted` on writes, `photos_unavailable` without a store (R11–R13). Mounted in `app.ts`.
- `drafts/response.ts`: `draftInclude` adds `idea {id, title}` and `_count.photos`; `draftResponse` adds `ideaId`, `idea`, `photoCount` (R6, R8).
- `drafts/routes.ts` delete: read the draft's photo public ids in the transaction, destroy after commit (R14). `projects/routes.ts` delete: add draft photos to the ids it already destroys (lesson: every cascade path).
- `ideas/response.ts`: `ideaInclude` adds `draft {id, name, status, convertedAt}`; `ideaResponse` adds `draftId`, `draft` (R6, R7).
- `ideas/toDraft.ts` (new) and mount next to `/task` (R3, R4, R15–R17).

**Mobile (`apps/mobile/src`)** — screens from the mockup
- `ideas/types.ts`, `drafts/types.ts`: new fields (`draftId`, `draft`; `ideaId`, `idea`, `photoCount`).
- `ideas/draftPrefill.ts` (new, like `taskPrefill.ts`): name cut to 60 at a word boundary, note from description, photo count; error-code → i18n key map, including network (R2, R5).
- `ideas/api.ts`: `createDraftFromIdea`.
- Idea detail `ideas/[ideaId]/index.tsx`: "Tạo nháp món từ ý tưởng" button (mockup B1) when `accepted` and no draft; link card with draft name and status (B3) otherwise (R1, R7).
- `drafts/new.tsx`: `fromIdea` param → prefilled form with the "Từ ý tưởng … · kèm N ảnh" line and 48pt thumbnails (B2); online create with the B2a/B2b messages, the "Mở nháp đó" link on `idea_already_has_draft`; on success put the draft in the drafts store and replace to the draft (R2–R5).
- `drafts/DraftsProvider.tsx`: a method to insert a server draft into the store and cache without queuing.
- `drafts/[draftId].tsx`: "Từ ý tưởng" LinkCard at the top (E1, E6), Photos section via the shared component (E1, E3–E6), the one-time notice (E2) driven by `photosNotCopied` passed in route params.
- `tasks/parent.ts` + `drafts/adapters.ts` (new) + `drafts/api.ts` + `drafts/entities.ts`: `"draft"` kind and `DRAFT_PHOTOS` scope; `canManagePhotos` = adder or Owner, and nothing is manageable once converted (R11–R13).
- `i18n/vi.json`, `en.json`: new keys (parity test enforces both).

**Navigation map**
- Idea detail → "Tạo nháp món từ ý tưởng" → push `drafts/new?fromIdea=<id>`. Huỷ or back → idea detail.
- New draft (from idea) → Tạo nháp → **replace** with `drafts/<draftId>` (as the normal New draft does), so back returns to the idea detail. "Mở nháp đó" (B2b) → replace with that draft.
- Idea detail link card → push `drafts/<draftId>`; back → idea.
- Draft detail "Từ ý tưởng" card → push `ideas/<ideaId>`; back → draft.
- Draft photo thumbnail → existing photo viewer; ✕ → draft.

## Risks

- **Sensitive Areas: schema, data, public API.** The Sensitive reviewer runs in Review.
- Orphan Cloudinary images: a copy that succeeds but isn't recorded. Covered by step 3 cleanup (R17); a cleanup that itself fails is logged and left, as idea photo cleanup does today. The cleanup only destroys ids this request created, never ids owned by a recorded row (lesson).
- Missed cascade path: draft photos must be destroyed on draft delete **and** project delete; both are in Changes and tested.
- Slow request: up to 10 copies. Limit 3 in parallel and a per-copy timeout (10 s, as destroy uses), so the worst case stays bounded; the phone shows the button spinner meanwhile.
- Concurrency: two members creating from one idea. The project lock serialises them; the `@unique` on `ideaId` is the backstop.
- Migration order: if another branch adds a migration and merges first, this one must be re-timestamped after it (lesson).
- Copy through `uploader.upload` from a signed URL is new. If Cloudinary refuses an authenticated URL as a source, fall back to a private download URL from the SDK; the store interface doesn't change. Checked by hand once in QA with the real account (Test Handoff).

## Test Strategy

Commands: `ourkit gate run test` (API Vitest against the test database, then mobile Vitest), `ourkit gate run lint`, `ourkit gate run build`. Run the API suite once at a time (lesson: shared test database).

- R1, R4, R10: API tests in `ideas/toDraft.test.ts` for each refusal code, each non-accepted status, a link kept after a status change, and a concurrency test (two parallel requests → one 201, one `idea_already_has_draft`).
- R3, R15: API test: 201, draft fields, `ideaId`, photos with new public ids, same size and caption, idea photos untouched; the fake store records copies.
- R16, R17: network failures are tested **only with an injected fake store** (fail chosen copies, hang one copy past the timeout, fail the record step), never a real closed port. Decided here so Review doesn't flip it (lesson).
- R6–R9: API tests on idea and draft responses, draft delete clears the link and allows a new draft, idea delete keeps the draft with `ideaId` null.
- R11–R13: `drafts/photos.test.ts` mirroring `ideas/photos.test.ts` plus the adder/Owner rule and `draft_converted`.
- R14: draft delete and project delete destroy draft photo images (fake store).
- Schema: a migration test that `Draft.ideaId` is unique with `ON DELETE SET NULL` and `DraftPhoto` cascades with its draft.
- Mobile unit tests: `draftPrefill` (cut at word boundary, counts, error keys), the draft adapter's `canManagePhotos`, i18n parity.
- **Test Handoff (by hand, on a phone with `npm run dev:phone` from this checkout after `db:deploy` on the dev database):** mockup screens B1–B3, E1–E6 and dark mode; offline message (B2a); navigation map above; one real copy against Cloudinary.
