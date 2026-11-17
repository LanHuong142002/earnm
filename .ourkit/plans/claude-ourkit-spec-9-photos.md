# Plan: Members can attach photos to tasks

Spec: `.ourkit/specs/claude-ourkit-spec-9-photos.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-9-photos.html` (approved).

## Approach

Photos get their own table and a small router under a task, following the checklist and comment pattern (phone-chosen ids, idempotent create, limits under the project lock, last-write-wins for the caption). Uploading is a three-step flow the phone drives: ask the API to **sign** an upload for one photo id, upload the compressed JPEG **straight to Cloudinary** with that signature, then **record** the photo with the API. Images are uploaded as Cloudinary `authenticated` assets, so they can only be fetched through signed URLs, which the API builds only in the members-only photo list. Deletes go through the API, which removes the row and then the Cloudinary image.

On the phone, a photo waiting to upload lives as a file in the app's document folder plus a queue entry, so it survives restarts and offline periods. Displaying uses `expo-image` with its disk cache, which also gives offline viewing of photos already seen.

This builds after #8 is merged, so its migration is ordered after #8's and the task screen already has the Bình luận section to sit above.

## Prior Art

- **Cloudinary's official Node SDK (`cloudinary`, v2)** for upload signatures (`utils.api_sign_request`), signed delivery URLs (`url(..., {type: 'authenticated', sign_url: true})`) and deletes (`uploader.destroy`). Reusing it instead of hand-writing SHA-1 signing avoids subtle signature bugs. It's server-only.
- **Expo's own modules** for the phone: `expo-image-picker` (camera and library, multi-select with a selection limit, permission status), `expo-image-manipulator` (resize and JPEG), `expo-file-system` (already installed) to keep waiting files, `expo-image` (already installed) to show and cache images. All run in Expo Go. Added with `npx expo install` so versions match the SDK.
- Upload to Cloudinary with `fetch` and `FormData` from the phone; no Cloudinary phone SDK is needed.
- Reuse from the project: `applyLastWriteWins`, `findForMember` / `lockProject`, `multiLineText`-style trimming (single line, 200), the checklist router's `requireTask` / `lockedMember` / `withRetry` pattern, `isInvolved` (from #8), the phone queue's `registerEntity`, `newId`, `ui/*` components, `SheetFrame` for the caption sheet.

## Changes

**Setup**
- `apps/api/package.json`: add `cloudinary`. `apps/api/src/config.ts`: optional `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; photos enabled only when all three are set. `apps/api/.env.example`, `render.yaml` and `docs/deploy.md`: the three variables, marked secret.
- `apps/mobile/package.json`: add `expo-image-picker`, `expo-image-manipulator`; `app.json`: camera and photo library usage strings in VI/EN.

**Database** (`schema.prisma`, new migration, timestamp after #8's)
- `TaskPhoto`: `id` (client UUID), `taskId` (cascade), `addedById` (nullable, set null), `publicId` (unique), `width`, `height`, `caption` (default ""), `captionEditedAt`, `createdAt`. Index `(taskId, createdAt, id)`.

**API** (`apps/api/src/photos/`)
- `cloudinary.ts`: a small wrapper (sign, signed URL for thumbnail 240px and full 1600px, destroy) behind an interface, so tests inject a fake and never call Cloudinary.
- `routes.ts` under `/projects/:projectId/tasks/:taskId/photos`:
  - `GET /`: member only; photos with `addedBy`, `caption`, `width`, `height`, `createdAt`, `thumbUrl`, `url`.
  - `POST /sign` body `{id}`: involved only (403), count < 10 (`photo_limit_reached`); returns `{cloudName, apiKey, timestamp, signature, publicId, folder, type: 'authenticated'}` with `publicId = earnm/<projectId>/<taskId>/<id>`.
  - `POST /` body `{id, publicId, width, height, caption?}`: involved, under the lock, count < 10, `publicId` must equal the one the server derives from the ids (so a phone can't attach someone else's image); idempotent same id/same task, 409 on another task.
  - `PATCH /:photoId` body `{caption: {value, editedAt}}`: involved; last-write-wins.
  - `DELETE /:photoId`: involved; deletes the row, then calls destroy; a failed destroy is logged, not shown to the user.
  - All return `503 photos_unavailable` when Cloudinary isn't configured.
- Task delete (`apps/api/src/tasks/routes.ts`): collect the task's `publicId`s before the delete and destroy them after it commits.

**Phone** (`apps/mobile/src/tasks/photos/`)
- `types.ts`, `api.ts`, `store.ts` (per-owner, per-task list cache), `prepare.ts` (pick → resize to 1600 px JPEG 0.7 → copy into `documentDirectory/pending-photos/`), `uploads.ts` (queue entity `photoUpload`: sign → upload to Cloudinary → record; states waiting/uploading/failed; retry and discard delete the local file), `overlay.ts` (merge uploads, queued caption edits and deletes over the cached list), `view.ts` (pure: count x/10 with waiting ones, free places, grid of 8 with "+N", who can add/delete/caption, empty-state visibility).
- `usePhotoPicker.ts` (permissions, camera vs library, `selectionLimit` = free places, settings link), `useTaskPhotos.ts`.
- Components: `PhotosSection.tsx` (mockup 1a–1c, 2a–2e, 3f), `PhotoThumb.tsx` (states), `PhotoViewer.tsx` (full-screen modal route with horizontal paging, mockup 3a, 3b, 3d, 3e), `CaptionSheet.tsx` (3c).
- Task screen: insert the section between Checklist and Bình luận.
- `i18n/vi.json`, `en.json`: `tasks.photos.*`.

## Risks

- **Sensitive Areas: data, schema, api.** The secret must stay on the server; signatures must fix the public id, folder and type; record must check the public id. Each has an API test.
- Signed URLs don't expire, so a member who saw a link could share it outside the app (decision logged). Acceptable for a small team; expiring links are out of scope.
- Images uploaded but never recorded (the phone dies between upload and record) are orphans on Cloudinary. The phone retries record on restart; leftovers are rare and harmless. Noted in the report rather than building a cleanup job.
- A failed Cloudinary destroy leaves an image no one can reach a link to. Logged.
- Expo Go module versions must match the SDK; use `npx expo install`.
- The user must set up Cloudinary before photos work (recorded as a service need). Until then the API returns 503 and the phone shows that photos aren't available.
- Migration order with #8: build this branch only after #8 is merged and rebased.

## Test Strategy

- `ourkit gate run test`, `ourkit gate run lint`, `ourkit gate run build`.
- API tests (`apps/api/src/photos/routes.test.ts`) with the fake Cloudinary: AC2, 4–14, 30, including 401, 404 for non-members, 403 for non-involved, the 10 limit on sign and record, the public id check, idempotent record and 409, destroy calls on photo delete and task delete, signature fields and that the secret is never in a response.
- Mobile unit tests: `view.ts`, `overlay.ts`, `uploads.ts` (state machine, reload, retry, discard deletes the file; Cloudinary and file system faked), `prepare.ts` resize options, permissions.
- Check: grep the mobile bundle sources for `CLOUDINARY_API_SECRET` and the secret's variable use.
- Test Handoff (by hand on the phone, after the user sets up Cloudinary): camera and multi-pick, size under 1 MB, offline add then upload, failed upload retry and discard, grid and "+N", viewer swipe, caption edit, delete, permission-refused message, involved vs non-involved member, light/dark, VI/EN, VoiceOver.
