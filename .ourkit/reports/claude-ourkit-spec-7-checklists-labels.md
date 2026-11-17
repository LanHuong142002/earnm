## Summary

Tasks (#7) get several named checklists with `x/y` progress, and project colour labels that members put on tasks and filter the task list by; Settings gets an Appearance choice (System / Light / Dark, icons and animation), and the Task screen gets Edit in the header.
Why: shop partners want to break a task into steps and group tasks at a glance; labels belong to the project so ideas (#11) can reuse them.
Verified: API 422/422 and mobile 580/580 tests, lint and build; a review plus a sensitive-area review, then two fix-only review rounds, ending with no blocking finding; 14 of 24 acceptance criteria pass by test, 10 are phone checks not yet done.
Watch: run `db:deploy` before starting the new API (two additive migrations: checklists_labels, then a default on Task.labelsEditedAt so the running server keeps working during rollout).
Left: the 10 phone checks in `.ourkit/reports/qa-7-phone-checklist.md`, and six deferred issues #31–#36 on the board.

## Details

**What's in it.**
- **API:**
  - Tables `Checklist`, `ChecklistItem`, `Label`, `TaskLabel` and `Task.labelsEditedAt`; existing tasks are backfilled from `createdAt`.
  - Routes `/projects/:projectId/labels` (GET, POST, PATCH, DELETE) and `/projects/:projectId/tasks/:taskId/checklists` with `/items`.
  - Task responses gain `labelIds` and `checklists`; task PATCH gains `labels` as one last-write-wins set.
  - Label names are unique per project ignoring case, spaces and Unicode form (`nameKey` with a unique index); delete is Owner-only, re-checked under the project lock.
  - Limits, counted under the project lock: 10 checklists per task, 50 items per checklist, 50 labels per project, 10 labels per task.
  - Idempotent creates on phone-chosen UUIDs, per-field last-write-wins (item text and done separately), one 404 body for anything not yours.
- **Phone:**
  - New queue entities for labels, checklists, items and a task's label set; the shared queue still has no label or checklist code.
  - A task's labels are their own waiting change, always sent after the label they use. Deleting a checklist drops its items' waiting changes. A label refused as a duplicate is stripped from waiting label sets before the next send.
  - Task cards show up to three label chips and `x/y`; the filter bar has a Labels row (match any).
  - Native form sheets for the label filter, the label picker and the label form; a pushed Labels screen (delete for Owners only).
  - Checklists edited on the Task screen: one-tap tick, add items in a row, rename and delete from `⋯`.
  - Eight label colours in `DESIGN.md` and the theme tokens, all at least 4.5:1, none the accent.
  - Appearance setting stored on the phone, kept after sign-out, applied before the first screen.

**Decisions.**
- Task labels are a set field like assignees, so two people changing them offline keep the later set (spec Out of Scope).
- The appearance choice isn't saved to the account (spec Out of Scope).
- Sheets use expo-router's `formSheet`, so no bottom-sheet library was added.
- Spec changes agreed at the mockup review: a centred header with only the back chevron, Edit in the header and Add beside the Checklist heading (R17), and the Appearance setting (R24).

**Review.**
- First round, 5 blocking findings, all fixed:
  - a task's labels could be sent before their label existed, losing other offline edits to the task;
  - moving a task's changes could send a task create after its own checklists;
  - stripping a duplicate label raced the next send;
  - the migration's `DROP DEFAULT` would break the running server's task creates during rollout;
  - (from the fix review) deleting a label that never reached the server left it in waiting label sets.
- Also fixed (non-blocking): a misleading test name, a test for editing a deleted label, a shape check on cached checklists, keeping unknown label ids when picking, and an untitled notice.
- Deferred by the user's choice, logged as Todo on the earnm MVP board:
  - #31: keep the valid labels when one in the set was deleted;
  - #32: a refused label rename keeps its colour change;
  - #33: page the task list;
  - #34: no second notice for a refused new label;
  - #35: robustness of waiting label sets;
  - #36: one damaged cached task shouldn't empty the offline copy.
- Found during Build: the project-lock test read a cached `pg_stat_activity` snapshot and missed a request that blocked after its first poll. The test now clears the snapshot before each poll.

**QA.**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | API tests: checklist name and item text of 0 and over the limit after trimming, or with control characters, are refused with `validation_failed`; 60 and 200 characters are accepted; an 11th checklist on a task and a 51st item in a checklist are refused with a clear error; a new item is not done. | API tests in apps/api/src/checklists/routes.test.ts: name 0/60/61, text 0/200/201, control chars, 11th checklist and 51st item refused, new item not done (gate test: API 422/422). | ✅ pass |
| 2 | API test: checklists and items are returned in creation order, whatever order they were last edited in. | API tests 'keeps creation order after edits' and repeated-create in checklists/routes.test.ts. | ✅ pass |
| 3 | API tests: a Member can add, rename and delete a checklist and add, edit, tick and delete items on a task created by the Owner; deleting a checklist removes its items; deleting the task removes its checklists and items. | API tests: Member does everything on an Owner's task; checklist delete removes items; task delete cascades. | ✅ pass |
| 4 | API tests: a checklist and an item created with phone-chosen UUIDs keep them; sending the same create twice leaves one; reusing an id from another task is refused and doesn't change the original. | API tests: repeat create returns 200 with stored copy; concurrent double create makes one; id under another task/project gives id_conflict and leaves the original unchanged. | ✅ pass |
| 5 | Unit test of progress: 0 items gives no progress; items across two checklists with 3 of 7 done give `3/7` for the task and the right count per checklist. | Unit test apps/mobile/src/tasks/progress.test.ts: null with no items; 3 of 7 across two checklists; per-checklist counts. | ✅ pass |
| 6 | API tests: label names of 0 and 31 characters, an unknown colour key, and a 51st label are refused; a name equal to an existing one apart from case and spaces is refused with a clear duplicate error. | API tests apps/api/src/labels/routes.test.ts: name length, unknown colour, 51st label, case/space/diacritics duplicate refused with label_name_taken. | ✅ pass |
| 7 | API tests: a Member can create, rename and recolour a label; a Member deleting one gets `403`; an Owner deleting one removes it from every task that had it; deleting a project removes its labels. | API tests: Member create/rename/recolour allowed; Member delete 403; Owner delete removes the label from tasks; project delete removes labels. | ✅ pass |
| 8 | API tests: putting a label on a task works; a label from another project, an unknown label id, the same label twice, or an 11th label are refused with `validation_failed`. | API tests apps/api/src/tasks/routes.test.ts: setting labels; another project's label, unknown id, duplicate and 11th label refused with nothing changed. | ✅ pass |
| 9 | API test: reading tasks returns each task's label ids and checklists with items in order; reading labels returns id, name and colour for that project only. | API tests: tasks return labelIds and checklists with items in order; labels list returns only the project's labels (id, name, colour). | ✅ pass |
| 10 | API tests: every new or changed endpoint without a token, or with an expired one, gives `401 not_signed_in`; a project the caller isn't in, and a checklist, item or label from another task or project, give `404` with the same body. | API tests: 401 not_signed_in without token and with an expired one on every checklist and label route; identical 404 body for non-member, cross-task, cross-project and malformed ids. | ✅ pass |
| 11 | API tests: an older change to an item's done state is ignored while a newer change to its text in the same request is accepted; the same for a label's colour and name; a future time is stored as the server's time; a task's labels are replaced as a whole set by the newer change; an ignored change returns `200` with the current state. | API tests: older done ignored while newer text accepted; same for label colour vs name; future time capped; label set replaced as a whole by the newer one; ignored change returns 200 with current state. | ✅ pass |
| 12 | API test: a change to a deleted item, checklist or label gives `404`. | API tests: change to a deleted item, checklist or label gives 404. | ✅ pass |
| 13 | By hand: open a task with checklists and labels, turn on airplane mode, close and reopen the app: the task card and details show them with the offline note. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Mở một công việc có checklist và nhãn. 2. Bật chế độ máy bay, tắt hẳn app rồi mở lại. - Mong đợi: thẻ công việc và màn Công việc vẫn hiện checklist và nhãn, có dòng "Đang ngoại tuyến". | 🙋 by hand |
| 14 | Tests of the queue: two ticks of the same item leave one waiting change; creating then editing a checklist leaves one create; creating then deleting an item sends nothing. Code check: the shared queue code has no reference to checklists or labels. By hand: in airplane mode, create a label, put it on a task, add a checklist and tick an item; reconnect and see all of it on a second phone or in the API. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Bật chế độ máy bay. 2. Tạo nhãn mới, gắn nó vào một công việc, thêm một checklist và tick một mục. 3. Tắt chế độ máy bay, đợi vài giây. - Mong đợi: trên máy thứ hai (hoặc sau khi kéo làm mới), nhãn, checklist và mục đã tick đều có. Không hiện "Không lưu được". | 🙋 by hand |
| 15 | Tests of the outcomes: a refused checklist or item change puts back the server's version (or removes it on `404`) and shows the "couldn't be saved" message; a label refused as a duplicate disappears from the local copy and from the task it was put on. | Unit tests apps/mobile/src/tasks/checklistSync.test.ts: refused change restores server version with notice; 404 removes it; a duplicate label is removed from the label list, the task and waiting label sets. | ✅ pass |
| 16 | By hand: a card shows up to three label chips then `+n`, and `x/y` only when the task has items. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Xem thẻ có 0, 1, 3 và từ 4 nhãn trở lên; xem công việc có và không có mục checklist. - Mong đợi: tối đa 3 chip nhãn rồi `+n`; `x/y mục` chỉ hiện khi công việc có mục. | 🙋 by hand |
| 17 | By hand: tick and untick an item with one tap and see both progress counts change at once; add several items in a row with the keyboard staying open; rename and delete a checklist, with the delete confirmation naming it. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Chạm ô vuông một lần để tick, chạm lần nữa để bỏ tick. 2. "＋ Thêm mục": gõ rồi Return vài lần liên tiếp. 3. ⋯ → Đổi tên checklist; ⋯ → Xóa checklist. - Mong đợi: hai số tiến độ (của checklist và tổng) đổi ngay; bàn phím vẫn mở khi thêm liên tiếp; hộp xác nhận xoá nêu tên checklist. | 🙋 by hand |
| 18 | By hand: the label picker adds and removes labels on a task, and "New label" creates one and puts it on the task. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Ở màn Công việc, chạm "Sửa"/"Thêm" cạnh Nhãn; chạm để gắn và bỏ nhãn. 2. Chọn "＋ Nhãn mới", đặt tên và màu, tạo. - Mong đợi: gắn/bỏ có hiệu lực ngay; nhãn mới được tạo và gắn luôn vào công việc. Sheet vuốt xuống thì đóng. | 🙋 by hand |
| 19 | By hand: as a Member, the Labels screen offers create, rename and recolour but no delete; as an Owner, delete asks for confirmation naming the label and the label disappears from its tasks. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Bằng tài khoản Member: Quản lý nhãn → thử tạo, đổi tên, đổi màu. 2. Bằng tài khoản Owner: mở một nhãn → Xóa nhãn. - Mong đợi: Member không thấy nút xoá; Owner thấy hộp xác nhận nêu tên nhãn và nói nhãn bị gỡ khỏi mọi công việc; sau khi xoá, nhãn biến mất khỏi các công việc. | 🙋 by hand |
| 20 | Unit tests of the filters: one label, two labels (a task with either matches), and a label combined with a status and "Assigned to me" select the right tasks; a remembered deleted label is ignored. By hand: the label choice survives closing and reopening the app and clears with the other filters. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Ở danh sách công việc, hàng "Nhãn" → chọn một hoặc hai nhãn. 2. Tắt hẳn app rồi mở lại. 3. Chạm "Bỏ bộ lọc" (khi không còn công việc phù hợp) hoặc bỏ chọn hết. - Mong đợi: lọc vẫn còn sau khi mở lại; bỏ bộ lọc thì xoá cả lọc nhãn. | 🙋 by hand |
| 21 | By hand, in light and dark mode: all 8 label colours show their names readably, and no label uses the accent colour. Check: each colour's text contrast is at least 4.5:1. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Mở "Nhãn mới", xem 8 ô màu ở chế độ sáng và tối. - Mong đợi: đọc rõ tên trên mọi màu; không màu nào giống màu cam chính của app. | 🙋 by hand |
| 22 | By hand, in both languages: no untranslated text, and the new screens follow `DESIGN.md` and Decision 10. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Đổi giữa Tiếng Việt và English, đi qua mọi màn mới. - Mong đợi: không còn chữ chưa dịch; màn hình giống mockup đã duyệt và DESIGN.md. | 🙋 by hand |
| 23 | The migration applies cleanly to an empty database and to one with existing users, projects and tasks. | Migration applied cleanly to the empty test DB; apps/api/src/tasks/schema.test.ts applies it to a schema with an existing task (labelsEditedAt = createdAt) and checks an old-style insert works after the default migration. | ✅ pass |
| 24 | Unit test of the stored appearance choice: a missing or unknown stored value reads as System. By hand: choosing Dark with the phone in light mode turns every screen, header, sheet and alert dark at once; System follows the phone again; the choice survives closing the app and signing out; the Task screen shows "Edit" in the header and "Add" beside the Checklist heading without scrolling. | Needs a phone; not checked yet. Unit/API parts pass where they exist. Steps in .ourkit/reports/qa-7-phone-checklist.md: 1. Cài đặt → Giao diện → chọn Tối khi điện thoại đang sáng; rồi Sáng; rồi Theo hệ thống. 2. Tắt app mở lại; đăng xuất rồi đăng nhập lại. 3. Mở một công việc. - Mong đợi: mọi màn, header, sheet, hộp thoại đổi theo ngay, có animation; lựa chọn còn sau khi mở lại và sau khi đăng xuất; "Sửa" nằm trên header, "＋ Thêm" cạnh tiêu đề Checklist, không cần cuộn. | 🙋 by hand |

**Not verified.** No screen has been run on a device or simulator yet, so the look against the approved mockup, sheets, keyboard behaviour, animation, dark mode, offline use and both languages are unchecked (criteria 13, 14, 16–22, 24). Steps: `.ourkit/reports/qa-7-phone-checklist.md`, starting with `npm run dev:phone` from this branch.
