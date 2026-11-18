# Change Report: Members can attach photos to tasks (#9)

## Summary

What changed: tasks have an Ảnh section (up to 10 photos, 4 per row, "+N"), a full-screen viewer with optional captions, and offline-queued uploads to Cloudinary through server-signed, authenticated uploads; only involved people (creator + assignees) add, delete or caption.
Why: partners need to share receipts and cup samples on a task (Decision 7); the user set the permission rule and captions at the mockup review.
How it was verified: API 469 and mobile 741 tests pass, lint and build pass, three reviews plus a re-review of the fix, QA of 30 criteria with 16 passed and 14 by hand; migration applied to a fresh and a seeded database.
What to watch for: the Cloudinary secret stays on the server; images are destroyed on photo, task and project delete; signed links never expire; this branch is stacked on #8.
What's left: create a Cloudinary account and set three variables, the on-device checks in the Test Handoff, and a few non-blocking hardening items.

## Details

**Built**
- API: `TaskPhoto` table (migration `20261117120000_task_photos`, after #8's), `cloudinary` SDK wrapper (`PhotoStore`: sign with `type: authenticated` and `overwrite: false`, signed delivery URLs, destroy with a 10 s timeout), router under `/projects/:projectId/tasks/:taskId/photos` (list, sign, record, caption, delete), destroy after commit on photo, task and project delete, 503 `photos_unavailable` without configuration. `.env.example`, `render.yaml`, `docs/deploy.md` list the three variables.
- Phone: `expo-image-picker`, `expo-image-manipulator`; `tasks/photos/` data layer (1600 px JPEG prepare, persistent upload queue: sign → Cloudinary → record, failed/retry/discard, caption and delete queue, cache) and UI (`PhotosSection`, `PhotoThumb`, viewer route, `CaptionSheet`), between Checklist and Bình luận; iOS usage strings in VI/EN.

**Decisions** (Decision Log): involved = creator + assignees; authenticated delivery with non-expiring signed URLs (free plan); 1600 px JPEG; 503 instead of failing at startup; official SDKs; stacked on #8; UI departures: a `viewer` colour token (black, scrim 0.55) added to `tokens.ts` but not yet to `DESIGN.md`, spinner instead of ring, viewer time in the comment time format, caption sheet as a page-sheet modal.

**Review**
- Blocking, fixed: deleting a project left its images on Cloudinary (now destroyed after commit).
- Non-blocking, fixed: images uploaded but refused at record (limit or task gone) are destroyed; deletes answer before calling Cloudinary; signatures carry `overwrite: false` so an existing image can't be replaced; delete is queued before failed changes are dropped; only a vanished task (not a database error) marks an upload orphaned.
- Open non-blocking: caption trimmed on upload but not on edit (the server trims); every 5xx is retried while a comment mentions only 503; deleting a task leaves its pending local files and queued uploads (they end as failed items); `/sign` has no rate limit and no format or size cap; a record refused with 403 leaves its image on Cloudinary; the "already exists" check matches Cloudinary's message text; a destroy can be lost if the server exits right after answering.

**QA**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | By hand: take a photo and pick 3 from the library; all appear. The library picker can't select more than the free places. | Needs a device: camera and multi-pick; pickerOptions unit tests (selectionLimit = free places) passed | 🙋 by hand |
| 2 | API test: signing and recording are refused once a task has 10 photos, with a distinct error code. Unit test: the phone counts waiting photos toward 10. | API test 'refuses signing and recording once a task holds 10 photos, with photo_limit_reached' passed; mobile 'full at 10 even when some are waiting' passed | ✅ pass |
| 3 | Unit test: the resize settings keep the longer side at 1600 px and use JPEG. By hand: an uploaded photo is under 1 MB. | prepare.test.ts passed (1600 px longer side, JPEG 0.7); the under-1 MB size needs a real upload | 🙋 by hand |
| 4 | API test: a recorded photo comes back with who added it and when. | API record test passed: the photo comes back with who added it and when | ✅ pass |
| 5 | API test: an involved person deletes a photo; it's no longer listed and the Cloudinary delete is called for its image. | API delete test passed: no longer listed, destroy called; 204 even when destroy fails | ✅ pass |
| 6 | API test: set, change and clear a caption; 201 characters is refused with `validation_failed`. | API caption test passed: set, change, clear; 201 characters refused with validation_failed | ✅ pass |
| 7 | API test: a member who isn't involved gets `403` for signing, recording, deleting and captioning. | API test 'refuses sign/record/caption/delete to an uninvolved member' passed (403) | ✅ pass |
| 8 | API test: deleting a task removes its photo rows and calls the Cloudinary delete for each image. | API test 'task delete removes rows and destroys images' passed; project delete also destroys (review fix) | ✅ pass |
| 9 | API test: the signature is valid for the fixed name, folder and type, and is refused (`403`) for someone not involved. Check: the secret appears nowhere in the phone app's code or responses. | API 'never returns the secret' and signature field tests passed; grep: no Cloudinary secret in apps/mobile, app.json or package.json | ✅ pass |
| 10 | API test: the photo list returns signed image addresses; a non-member gets `404`. | API list test passed with signed thumbUrl/url from the store; non-member gets 404 | ✅ pass |
| 11 | API test: listing shows only recorded photos. | API test 'listing shows only recorded photos' passed | ✅ pass |
| 12 | API test: a signed-out request gets `401`; a non-member gets `404` for every photo endpoint. | API tests: 401 signed out, 404 for a non-member on every photo route, passed | ✅ pass |
| 13 | API test: an older caption edit doesn't overwrite a newer one; changing a deleted photo gets `404`. | API tests: an older caption edit doesn't overwrite a newer one; 404 on a deleted photo; passed | ✅ pass |
| 14 | API test: recording the same id twice on one task gives one photo; the same id on another task gets `409`. | API tests: same id twice on one task gives one photo; same id on another task gets 409; passed | ✅ pass |
| 15 | By hand: photos seen on a task still show with the phone offline. | Needs a device: offline display from the expo-image disk cache | 🙋 by hand |
| 16 | Unit test: a waiting photo survives a reload of the upload queue. By hand: add a photo offline, see "Chờ mạng", restart the app, go online, it uploads. | Unit: a waiting upload survives a new queue on the same storage (passed); restart on a real phone needs a device | 🙋 by hand |
| 17 | Unit test: the upload moves through waiting, uploading and done. By hand: "Đang tải" with a spinner while uploading. | Unit: waiting → uploading → done passed; the 'Đang tải' spinner needs a device | 🙋 by hand |
| 18 | Unit test: a failed upload offers retry and discard, and discard deletes the local file. By hand: the failed thumbnail and its sheet. | Unit: retry, discard (deletes the local file) passed; the failed thumbnail and its sheet need a device | 🙋 by hand |
| 19 | Unit test: an offline delete and caption change are queued and sent later. | Mobile tests: queued delete and caption edit sent later with their edit time, passed | ✅ pass |
| 20 | By hand, against the mockup: the Ảnh section sits below Checklist and above Bình luận, with "x/10" and "＋ Thêm" for involved people. | Needs a device against the mockup; related unit tests (addState, pickerProblem, viewerStart, afterDelete, captionCounter) passed | 🙋 by hand |
| 21 | By hand: thumbnails four per row, at most 8, "+N" on the 8th; tapping opens the viewer at that photo. Unit test: the grid. | Unit 'with 10 photos shows 8 tiles and +3 on the 8th' passed; four per row and opening the viewer need a device | 🙋 by hand |
| 22 | By hand: "＋ Thêm" offers "Chụp ảnh" and "Chọn từ thư viện" with the places left. | Needs a device against the mockup; related unit tests (addState, pickerProblem, viewerStart, afterDelete, captionCounter) passed | 🙋 by hand |
| 23 | By hand: with 10 photos "＋ Thêm" is disabled with the explaining line. | Needs a device against the mockup; related unit tests (addState, pickerProblem, viewerStart, afterDelete, captionCounter) passed | 🙋 by hand |
| 24 | By hand: the empty state for an involved member, and no section for a member who isn't involved. | Needs a device against the mockup; related unit tests (addState, pickerProblem, viewerStart, afterDelete, captionCounter) passed | 🙋 by hand |
| 25 | By hand: after refusing camera access, the message and the button that opens Settings. | Needs a device against the mockup; related unit tests (addState, pickerProblem, viewerStart, afterDelete, captionCounter) passed | 🙋 by hand |
| 26 | By hand: the viewer swipes, shows "n / total", caption, who and when; involved people see caption and delete controls; after a delete it moves on or closes. | Needs a device against the mockup; related unit tests (addState, pickerProblem, viewerStart, afterDelete, captionCounter) passed | 🙋 by hand |
| 27 | By hand: the caption sheet with Huỷ, Chú thích, Lưu and the 200-character limit; saving empty clears it. | Needs a device against the mockup; related unit tests (addState, pickerProblem, viewerStart, afterDelete, captionCounter) passed | 🙋 by hand |
| 28 | By hand: light and dark mode, VI and EN, VoiceOver names on thumbnails and buttons. | Needs a device: light/dark, VI/EN, VoiceOver; thumbLabelKey unit tests passed | 🙋 by hand |
| 29 | Check: `prisma migrate deploy` succeeds on an empty test database and on one with existing tasks, after #8's migration. | Applied all 9 migration SQL files to a fresh scratch DB, and to a second one where a project and task were inserted before the photos migration; TaskPhoto created, task kept; both DBs dropped | ✅ pass |
| 30 | API test: without the Cloudinary variables, photo endpoints answer `photos_unavailable` (503) and task endpoints still work. | API test 'answers photos_unavailable (503) without Cloudinary while task routes still work' passed | ✅ pass |

**Not verified here:** no real Cloudinary call was made (signing is checked against a hand-computed SHA-1; uploads, delivery URLs and destroy use fakes in tests); everything marked by hand above. The spec's acceptance criteria were renumbered one per line before QA so each could be tracked; their content didn't change.

**Also in this PR:** after the user reviewed #8 (already merged), the "Đã xem hết bình luận" end-of-list line under comments was removed; the #8 spec R18 is updated to match. Reviewed on its own commit; test and lint pass.
