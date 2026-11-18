# Spec: Members can collect, discuss and vote on ideas

Ticket: #11 (Epic F10). Tier: Feature. Sensitive Areas: data, schema, public-api. Mockup: `.ourkit/mockups/claude-ourkit-spec-11-ideas.html` (bản 1, approved by the user on 2026-11-18). Mode: Hands-off.

## Goal

Each project gets an ideas board. Members write down ideas (title, description, photos, labels), discuss them in comments, vote up or down, and move them through New → Considering → Accepted or Dropped. An accepted idea becomes a task in one tap, so the group decides together what to try next (Decision 11).

Today a project has tasks with labels (#7), comments (#8) and photos (#9) (`apps/api/prisma/schema.prisma`; `apps/api/src/{tasks,labels,comments,photos}/routes.ts`; mobile `apps/mobile/src/tasks/`). Those are task-specific, so ideas get their own models and routes that reuse the project `Label` table, the Cloudinary signing store and the mobile sync queue, following the same conventions (phone-chosen ids, per-field last-write-wins, offline queue, members-only signed image URLs).

## Requirements

### Ideas

1. A project member can create an idea: title 1–120 characters (trimmed), optional description up to 2000, up to 10 project labels, up to 10 photos. It records its author and creation time and starts as **New**.
2. The author and the project Owner can edit title, description, labels and photos, and delete the idea after confirming. Others cannot (`403`).
3. Any project member can change an idea's status among New, Considering, Accepted, Dropped.
4. A project holds at most 500 ideas; one more is refused with a distinct error.
5. Deleting an idea deletes its comments, votes and photos (images destroyed in Cloudinary). Deleting the project does the same for all its ideas. A task created from the idea stays.
6. Deleting a label removes it from ideas. If the author's account is gone, the idea shows "Người dùng cũ" / "Former member".
7. Edits resolve last-write-wins per field (title, description, status, labels); the same id twice is idempotent; non-members get `404`, signed out `401`.

### Votes

8. Each member has at most one vote per idea: up (+1) or down (−1). Choosing the same again removes it; choosing the other switches it. Voting on one's own idea is allowed.
9. Everyone sees the score (ups minus downs) and their own vote; nobody sees who voted what.

### Comments

10. Members can comment on ideas with the same rules as task comments (#8 R1–R6, R11–R16): 1–1000 characters, author edits/deletes, "đã sửa", 500 per idea, batches of 5, Mới nhất / Cũ nhất. There is no "Nhắc kèm" bell on idea comments.

### Photos

11. Idea photos work like task photos (#9): signed upload straight to Cloudinary, members-only signed URLs, caption, viewer, delete. Only the author and the Owner can add or delete them.

### Create task from idea

12. When an idea is **Accepted**, its screen shows "Tạo công việc từ ý tưởng". It opens the new-task form prefilled with title, description and labels, with a line "Từ ý tưởng “…” · kèm N ảnh".
13. Saving creates the task, copies the idea's photos to it as new images (the idea keeps its own), and links the idea to the task. An idea can create only one task; afterwards its screen shows "Đã tạo công việc" with the task's title and status, opening the task. The task screen shows "Từ ý tưởng …" opening the idea.
14. If the task is later deleted, the idea's link clears and the button shows again (if still Accepted). If the idea is deleted, the task's back-link disappears.
15. Creating a task from an idea requires network (photo copy happens on the server); offline, the button shows a short "Cần có mạng" note.

### On the phone: screens

16. The project screen's **Ý tưởng** tile is enabled, with a caption counting New ideas ("3 mới"), opening the ideas list.
17. Ideas list: status filter pills (Tất cả / Mới / Cân nhắc / Đã chọn) and the label filter like the task list; rows with ▲ score ▼ on the left (own vote highlighted), title, status pill, label chips, comment and photo counts and author. Order: score high to low, then newest first. Dropped ideas sit in a collapsed "Đã bỏ (n)" section at the end, greyed. "＋ Mới" in the header.
18. Empty list: heading, one line, secondary "Thêm ý tưởng". Loading: skeleton blocks. Load error: `dangerBg` card with "Thử lại".
19. Idea screen: title, info card (status picker sheet, labels, description, author and date), big vote buttons "Ủng hộ" / "Không" with the score, the create-task button or link (R12–R13), Ảnh, Bình luận. "Sửa" in the header for author and Owner only.
20. New / edit idea screen: title, description, labels, photos, primary "Lưu ý tưởng" / "Lưu"; "Xoá ý tưởng" on edit for author and Owner.
21. Selections (filter pills, status sheet rows, vote buttons) are shown by highlight only, with no tick marks (user's review, 2026-11-18). The "Đã chọn" status pill keeps its check icon.
22. Offline: "Đang ngoại tuyến" note; creating, editing, voting, status changes and comments queue like tasks and show "Chờ lưu"; refused changes show the existing rejected notice.
23. Light and dark mode with `DESIGN.md` tokens, VI and EN, 44pt targets, accessible names (vote buttons announce the score and own vote).

**Navigation:** Project → Ý tưởng tile pushes the ideas list; "＋ Mới" or the empty button pushes "Ý tưởng mới", Lưu pops back to the list. A row pushes the idea screen; "Sửa" pushes "Sửa ý tưởng", Lưu pops back to the idea, a confirmed delete pops back to the list. "Tạo công việc từ ý tưởng" pushes the new-task form; "Tạo công việc" replaces it with the new task's screen so back returns to the idea. The link "Đã tạo công việc" pushes the task screen; the task's "Từ ý tưởng" pushes the idea screen. Back is chevron or swipe everywhere.

### Data

24. A migration adds ideas, idea labels, idea votes, idea comments, idea photos and the idea↔task link. It applies to empty and existing databases.

## Acceptance Criteria

1. API test: a member creates an idea; it's New with author and time; bad title, 2001-character description, 11 labels and foreign labels are refused.
2. API test: the author and the Owner edit and delete; another member gets `403`.
3. API test: any member changes status.
4. API test: the 501st idea is refused with `idea_limit_reached`.
5. API test: deleting an idea removes comments, votes and photo rows and destroys images (store faked); deleting the project destroys idea images too; a task created from it stays.
6. API test: deleting a label removes it from ideas. Unit test: missing author maps to the neutral name.
7. API test: older edits don't overwrite newer per field; same id twice gives one idea; non-member `404`; signed out `401`.
8. API test: vote up, vote up again removes, vote down switches; own idea allowed.
9. API test: the list returns score and the caller's own vote only.
10. API test: idea comments create, edit (edited flag), delete, author-only, 500 limit, paging; no remindWith field. By hand: the comments section without bells.
11. API test: idea photo sign/record/delete limited to author and Owner, 10 limit, members-only list with signed URLs.
12. By hand, mockup 2c–2d: the button shows only when Accepted and opens the prefilled form.
13. API test (store faked): create-task-from-idea creates the task with labels, copies photos to new public ids, links both ways, refuses a second time with `409`.
14. API test: deleting the task clears the idea's link; deleting the idea clears the task's back-link.
15. Unit test: the create-task button state is "needs network" offline.
16. By hand, mockup 1a: the tile is enabled with the New count. Unit test: count.
17. Unit test: ordering and filters. By hand, mockup 1b: row layout and collapsed Dropped section.
18. By hand, mockups 1c–1d: empty, loading, error with retry.
19. By hand, mockups 2a, 2b, 2e: idea screen, status sheet, created-task link; Sửa only for author and Owner.
20. By hand, mockups 3a–3b: new and edit forms, delete confirm.
21. By hand: no tick marks on selections.
22. Unit test: queued idea changes merge per idea and votes per idea. By hand, mockup 3c: offline "Chờ lưu", syncs after reconnect.
23. By hand, mockup 3d: dark mode; EN text; VoiceOver on vote buttons.
24. Check: `prisma migrate deploy` succeeds on an empty test database and on one with existing data.

## Out of Scope

- "Create product" from an idea (#15).
- New-idea push and any activity push (#16).
- Sharing ideas across projects; idea templates; seeing who voted.
- "Nhắc kèm" or reminders on ideas.

## Open Questions

Non-blocking, settled by assumption in the Decision Log and listed in the Question Batch: list order, one vote per person and anonymity, who changes status and who edits, one task per idea, copying photos to the task.
