# Spec: An accepted idea can become a drink draft (#50)

Ticket: https://github.com/LanHuong142002/earnm/issues/50
Mockup: `.ourkit/mockups/claude-ourkit-spec-15-idea-product.html`, group B (B1–B3).
Tier: Feature (schema, data, public API).

## Goal

A shop partner can turn an idea in status Đã chọn into a drink draft in one step, prefilled from the idea (name, note and photos), and move between the idea and its draft from either side. This replaces the old "accepted idea → product" path and works like "Tạo công việc từ ý tưởng".

To carry the idea's photos, drafts get photos of their own in this change (pulled forward from #53), and the server learns to copy a photo to a new Cloudinary image.

Decisions from the user (2026-11-27): photos are in scope; creating a draft from an idea needs a connection; deleting the draft frees the idea to make a new one. Decisions taken on the recommended defaults while the user was away, to confirm at spec review: D1 who manages draft photos, D2 what happens when a photo copy fails, D3 #43 stays separate (see Open Questions).

## Requirements

**Create a draft from an idea**

1. An idea in status Đã chọn (`accepted`) that has no linked draft shows a second action, "Tạo nháp món từ ý tưởng", below "Tạo công việc từ ý tưởng" (mockup B1). Any member of the project can use it, as with the task action.
2. The action opens the New draft form prefilled (mockup B2): name = the idea's title, cut to the draft name limit (60 characters) at a word boundary where possible; note = the idea's description (both limits are 2000, so no cut). Both stay editable. Sizes and expected price start empty, as on the normal New draft form. A line "Từ ý tưởng “<idea title>” · kèm N ảnh" shows above the fields; "· kèm N ảnh" is left out when the idea has no photos.
3. Saving sends one request to a new endpoint, `POST /projects/:projectId/ideas/:ideaId/draft`, with the draft's id and the edited fields. The server creates the draft, links it to the idea, and copies the idea's photos to the draft, in that order, and replies with the draft and the updated idea.
4. The server refuses, with nothing created:
   - `409 idea_not_accepted` when the idea is not Đã chọn;
   - `409 idea_already_has_draft` when the idea already has a linked draft;
   - `409 id_conflict` when the draft id is taken;
   - `409 draft_limit_reached` at the project's draft limit;
   - `404` when the idea is not in the project; `403`/`404` as today for non-members.
   Two members pressing at the same moment get one draft; the other gets `idea_already_has_draft`.
5. Creating needs a connection. Nothing is queued: on any failure the form stays open with its edits and a message for that error, and the person tries again (same as the task action).

**The link between idea and draft**

6. An idea links to at most one draft, and a draft comes from at most one idea. The link is stored on the server and returned on both: the idea carries its draft's id, name and status; the draft carries its idea's id and title.
7. On the idea, once linked, the action becomes a link card "Đã tạo nháp món · <draft name> · <draft status>" that opens the draft (mockup B3). The task action is unaffected.
8. On the draft, a line "Từ ý tưởng “<idea title>”" opens the idea. It stays after the draft is converted to a product.
9. Deleting the draft removes the link: the idea shows the create action again (if still Đã chọn). Deleting the idea removes the link on the draft; the draft stays.
10. The link stays when the idea later leaves Đã chọn; only creating a new draft needs Đã chọn.

**Draft photos**

11. A draft has photos like an idea: up to 10, each with an optional caption (200 characters), uploaded straight from the phone to Cloudinary with a server signature, shown as thumbnails on the draft screen and full size on tap. They work offline the same way idea photos do (queued uploads, cached list).
12. (D1) Any member can add a photo to a draft. The member who added a photo and the project's Owners can edit its caption or delete it. Photos copied from an idea count as added by the member who created the draft.
13. Once a draft is converted, its photos stay visible but can't be added, edited or deleted (`409 draft_converted`), matching the rest of a converted draft.
14. Deleting a draft deletes its photos from Cloudinary, as deleting an idea or task does today.

**Copying the idea's photos**

15. Each of the idea's photos (up to 10) is copied to a new Cloudinary image with its own public id under the draft, with the same width, height and caption. The idea's photos are not changed, and later changes on either side don't affect the other.
16. (D2) If some copies fail, the draft is still created with the photos that were copied, and the reply says how many were not carried over. The app shows "Không mang theo được N ảnh" once; the person can add them by hand. If Cloudinary isn't configured, the draft is created with no photos and the same notice.
17. A copy that succeeded on Cloudinary but whose draft was never saved (the request failed afterwards) is removed from Cloudinary, so no orphan images are left.

## Acceptance Criteria

1. R1: on an idea in Đã chọn with no draft, B1's "Tạo nháp món từ ý tưởng" shows; on an idea in any other status it doesn't. API test: `idea_not_accepted` for each other status.
2. R2: open the action on an idea with a 90-character title, a description and 2 photos; the form shows the title cut to ≤60 characters, the description as note, and "kèm 2 ảnh". With no photos the "kèm" part is absent. Unit test for the prefill.
3. R3, R15: API test: the endpoint returns 201 with a draft whose name and note are the sent values, `ideaId` set, 2 photos with new public ids, same sizes and captions; the idea's response carries the draft link; the idea's photos are unchanged.
4. R4: API tests for each refusal code, and a concurrency test: two simultaneous requests for one idea yield one draft and one `idea_already_has_draft`.
5. R5: with the phone offline, saving shows the network message, the form keeps its edits, and nothing appears in the drafts list after reconnecting.
6. R6–R8: on the phone, after creating, the idea shows B3's link card with the draft's name and status, and tapping it opens the draft; the draft shows "Từ ý tưởng …" and tapping it opens the idea. Still true after converting the draft to a product.
7. R9: API tests: delete the draft, the idea's `draft` is null and creating again succeeds; delete the idea, the draft's `ideaId` is null and the draft remains.
8. R10: API test: move a linked idea to another status; the link stays in both responses.
9. R11: on the phone, add, caption and delete photos on a draft, online and offline; the 11th photo is refused with the limit message. API tests mirror the idea photo tests.
10. R12: API tests: a member who didn't add a photo gets 403 on caption edit and delete; the adder and an Owner succeed.
11. R13: API test: add, edit, delete on a converted draft's photos return `409 draft_converted`; listing still works.
12. R14: API test with the fake photo store: deleting a draft destroys each of its photos' images.
13. R16: API test with a fake store that fails one of 3 copies: 201, 2 photos, `photosNotCopied: 1`; the phone shows "Không mang theo được 1 ảnh".
14. R17: API test: a failure after the copies (for example the draft create refused) destroys the copied images.
15. Existing idea, task, draft and photo tests still pass; `ourkit gate run test`, lint and build pass.

## Out of Scope

- Comments and like/unlike on drafts (stay in #53, which shrinks to those two).
- Copying photos when a task is created from an idea (#43); it can reuse this change's copy step later.
- Creating a draft from an idea offline.
- Creating a draft from a comment (#51).
- Rate limits or format and size limits on photo signatures (#42); draft photos follow the same rules idea photos have today.
- Moving the photo cleanup of a deleted draft into a background retry; it works like idea photo cleanup does now.

## Open Questions

- D1 (R12): who manages draft photos. Assumed: anyone adds; the adder or an Owner edits and deletes. Alternative: every member can do everything, like other draft fields.
- D2 (R16): a failed photo copy. Assumed: create the draft anyway and report the missing photos. Alternative: refuse the whole create and clean up.
- D3: keep #43 separate (assumed) or fold it into this change.
