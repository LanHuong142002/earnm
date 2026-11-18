# Spec: Members can attach photos to tasks

Ticket: #9 (Epic F8). Tier: Feature. Sensitive Areas: data, schema, api. Mockup: `.ourkit/mockups/claude-ourkit-spec-9-photos.html` (bản 2, approved by the user on 2026-11-17).

## Goal

People involved in a task can attach up to 10 photos to it, such as receipts or cup samples, each with an optional caption, so the whole project sees the same thing. Photos are compressed on the phone and uploaded to Cloudinary through uploads the server signs, so the Cloudinary secret never leaves the server, and only members of the project can get a project's photos (Decision 7). Adding photos works offline: they wait on the phone and upload when it's back online.

Tasks, checklists and (in #8) comments already follow these conventions: phone-chosen ids, last-write-wins per field with `<field>EditedAt`, limits counted under the project lock, and a phone cache plus write queue (`apps/api/src/checklists/routes.ts`, `apps/api/src/http/last-write-wins.ts`, `apps/mobile/src/sync/queue.ts`). There is no image code in the project yet.

**Involved people** of a task are its creator plus its assignees (the same group as #8 and Decision 13).

## Requirements

### Photos

1. Involved people of a task can add photos to it, from the camera or the photo library. From the library they can pick several at once, up to the number of free places.
2. A task holds at most 10 photos, counting ones still waiting to upload. The server refuses an 11th, and the phone doesn't offer to add one.
3. Before upload, the phone shrinks each photo so its longer side is at most 1600 px and saves it as JPEG, so a typical photo is well under 1 MB.
4. Each photo records who added it and when.
5. Involved people can delete any photo of the task, after confirming. Deleting removes it for everyone and removes the image from Cloudinary.
6. Each photo has an optional caption of 0–200 characters after trimming. Involved people can add, change or clear it. Saving an empty caption clears it.
7. Members who aren't involved can see the photos and captions but can't add, delete or caption.
8. Deleting a task deletes its photos, including their images on Cloudinary.

### Uploads and privacy

9. The phone never holds the Cloudinary secret. To upload, it asks the API for a signature for one photo of one task; the API gives one only to an involved person, only while the task has a free place, and fixes the image's name and folder in the signature.
10. Images are stored so they can't be fetched by guessing a plain URL. The API hands out the image addresses only to members of the project, in the task's photo list.
11. A photo appears in the task only after its upload finished and the API recorded it.

### Permissions, errors and conflicts

12. Only members of the task's project can list or change its photos. For anyone else, the task looks like it doesn't exist.
13. Caption edits resolve last-write-wins. A change to a photo that no longer exists is refused as not found.
14. Recording a photo with an id that already exists on the same task succeeds without a second copy, so a retried send is safe.

### On the phone: offline

15. Photos a person has seen on a task stay visible offline from the phone's image cache, as far as it holds them.
16. A photo added offline appears at once with "Chờ mạng" / "Waiting for network" and uploads by itself when the phone is online, including after the app restarts.
17. While uploading, a photo shows "Đang tải" / "Uploading" with a spinner.
18. A failed upload shows "Lỗi · chạm để thử lại" / "Failed · tap to retry". Tapping offers "Thử lại" (Retry) and "Bỏ ảnh này" (Discard). No raw error text is shown.
19. Deleting a photo and changing a caption while offline are queued like other changes.

### On the phone: screens

20. The task screen has an **Ảnh** section below Checklist and above Bình luận, titled with the count "x/10", and "＋ Thêm" for involved people.
21. Photos show as square thumbnails, four per row, at most 8. With more than 8, the 8th shows "+N" on top. Tapping a thumbnail opens the viewer at that photo.
22. "＋ Thêm" opens a choice: "Chụp ảnh" (Take photo) or "Chọn từ thư viện" (Choose from library), with how many places are left.
23. With 10 photos, "＋ Thêm" is disabled and a line explains: "Đủ 10 ảnh. Xoá bớt một ảnh để thêm ảnh mới."
24. With no photos, involved people see one inviting line and a secondary "Thêm ảnh" button. For others, the section is hidden.
25. If camera or library access was refused, a message says so, with a button that opens the iPhone's Settings.
26. The viewer is full screen on black, swipes between photos, and shows "n / total", the caption, and who added the photo and when. Involved people also see "Sửa chú thích" or "＋ Thêm chú thích" and a delete button. After a delete it moves to the next photo, or closes when none are left.
27. Editing a caption opens a sheet with "Huỷ", "Chú thích" and "Lưu", and a field limited to 200 characters.
28. Everything works in light and dark mode, with the tokens in `DESIGN.md`, VI and EN text, touch targets of at least 44pt, accessible names on thumbnails and icon buttons, and image dimensions set so the layout doesn't jump.

### Data and setup

29. A database migration adds photos. It applies to an empty database and to one with existing data, and is ordered after #8's migration.
30. The API reads the Cloudinary cloud name, API key and API secret from environment variables. Without them, the photo endpoints answer that photos aren't available, and the rest of the API works.

## Acceptance Criteria

1. By hand: take a photo and pick 3 from the library; all appear. The library picker can't select more than the free places.
2. API test: signing and recording are refused once a task has 10 photos, with a distinct error code. Unit test: the phone counts waiting photos toward 10.
3. Unit test: the resize settings keep the longer side at 1600 px and use JPEG. By hand: an uploaded photo is under 1 MB.
4. API test: a recorded photo comes back with who added it and when.
5. API test: an involved person deletes a photo; it's no longer listed and the Cloudinary delete is called for its image.
6. API test: set, change and clear a caption; 201 characters is refused with `validation_failed`.
7. API test: a member who isn't involved gets `403` for signing, recording, deleting and captioning.
8. API test: deleting a task removes its photo rows and calls the Cloudinary delete for each image.
9. API test: the signature is valid for the fixed name, folder and type, and is refused (`403`) for someone not involved. Check: the secret appears nowhere in the phone app's code or responses.
10. API test: the photo list returns signed image addresses; a non-member gets `404`.
11. API test: listing shows only recorded photos.
12. API test: a signed-out request gets `401`; a non-member gets `404` for every photo endpoint.
13. API test: an older caption edit doesn't overwrite a newer one; changing a deleted photo gets `404`.
14. API test: recording the same id twice on one task gives one photo; the same id on another task gets `409`.
15. By hand: photos seen on a task still show with the phone offline.
16. Unit test: a waiting photo survives a reload of the upload queue. By hand: add a photo offline, see "Chờ mạng", restart the app, go online, it uploads.
17. Unit test: the upload moves through waiting, uploading and done. By hand: "Đang tải" with a spinner while uploading.
18. Unit test: a failed upload offers retry and discard, and discard deletes the local file. By hand: the failed thumbnail and its sheet.
19. Unit test: an offline delete and caption change are queued and sent later.
20. By hand, against the mockup: the Ảnh section sits below Checklist and above Bình luận, with "x/10" and "＋ Thêm" for involved people.
21. By hand: thumbnails four per row, at most 8, "+N" on the 8th; tapping opens the viewer at that photo. Unit test: the grid.
22. By hand: "＋ Thêm" offers "Chụp ảnh" and "Chọn từ thư viện" with the places left.
23. By hand: with 10 photos "＋ Thêm" is disabled with the explaining line.
24. By hand: the empty state for an involved member, and no section for a member who isn't involved.
25. By hand: after refusing camera access, the message and the button that opens Settings.
26. By hand: the viewer swipes, shows "n / total", caption, who and when; involved people see caption and delete controls; after a delete it moves on or closes.
27. By hand: the caption sheet with Huỷ, Chú thích, Lưu and the 200-character limit; saving empty clears it.
28. By hand: light and dark mode, VI and EN, VoiceOver names on thumbnails and buttons.
29. Check: `prisma migrate deploy` succeeds on an empty test database and on one with existing tasks, after #8's migration.
30. API test: without the Cloudinary variables, photo endpoints answer `photos_unavailable` (503) and task endpoints still work.

## Out of Scope

- Images on ideas (#11) and on comments (#8).
- Files other than photos, and video.
- Editing or cropping photos in the app, and reordering photos.
- Expiring image links.
- Push notifications about new photos (#16).

## Open Questions

None.
