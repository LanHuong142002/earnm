# Spec: Members can comment on tasks

Ticket: #8 (Epic F7). Tier: Feature. Sensitive Areas: data, schema, api. Mockup: `.ourkit/mockups/claude-ourkit-spec-8-comments.html` (bản 2, approved by the user on 2026-11-17).

## Goal

Members of a project can leave comments on a task, right inside the task screen, so whoever does the task knows the details. People involved in the task can mark a comment **Nhắc kèm** ("remind with"), so it can travel with the task's reminders later (#10, Decision 5). Comments work offline like the rest of the task.

Today a task has a title, description, status, due date, assignees, labels and checklists (`apps/api/prisma/schema.prisma`, `apps/api/src/tasks/routes.ts`, `apps/api/src/checklists/routes.ts`). Ids are chosen by the phone, conflicts resolve last-write-wins per field with `<field>EditedAt` (`apps/api/src/http/last-write-wins.ts`), and the phone keeps a cache plus a write queue with one entity per kind of thing (`apps/mobile/src/sync/queue.ts`, `apps/mobile/src/tasks/sync.ts`). Comments follow the same conventions.

**Involved people** of a task are its creator plus its assignees. This is the same group Decision 13 sends activity push to.

## Requirements

### Comments

1. A project member can add a comment to a task in that project. A comment has text of 1–1000 characters after trimming, which may span several lines. It records its author and when it was written.
2. The author of a comment can edit its text. An edited comment shows "đã sửa" / "edited" next to its time. Changing only "Nhắc kèm" doesn't count as an edit.
3. The author of a comment can delete it, after confirming. A deleted comment is gone for everyone, with no placeholder.
4. Nobody else can edit or delete someone's comment, including an Owner.
5. A task holds at most 500 comments. Adding one more is refused with a clear message.
6. Deleting a task deletes its comments. If an author's account is gone, the comment stays and shows a neutral name ("Người dùng cũ" / "Former member").

### Nhắc kèm (remind with)

7. A comment has a "Nhắc kèm" flag, off by default.
8. Only involved people of the task (its creator or an assignee, at the time of the change) can turn the flag on or off, on any comment of that task, including while writing a new comment. Anyone else who tries is refused.
9. Everyone in the project can see which comments have the flag on.
10. If someone stops being involved, the flags already set stay as they are.

### Permissions, errors and conflicts

11. Only members of the task's project can read or write its comments. For anyone else, the task looks like it doesn't exist.
12. Edits to the text and to the flag resolve last-write-wins per field, like other task fields. An edit or flag change to a comment that no longer exists is refused as not found.
13. Creating a comment with an id that already exists on the same task succeeds without making a second copy, so a retried send is safe.

### On the phone: offline

14. Comments a person has seen on a task stay readable offline.
15. Adding, editing, deleting and flagging comments while offline are queued and sent when the phone is back online, including after the app restarts. A waiting comment shows "Chờ gửi" / "Waiting to send" with a clock icon.
16. A queued change the server refuses for good (for example, the person was removed from the project) shows "Không gửi được" / "Couldn't send" on that comment, with "Thử lại" (Retry) and "Bỏ" (Discard). No raw error text is shown.

### On the phone: screens

17. The task screen has a **Bình luận** section below Checklist (and below Ảnh once #9 lands), with the comment count. There is no separate comments screen.
18. The section shows comments in batches of 5. "Xem thêm bình luận (N)" loads the next 5 below, without leaving the screen. When all are shown, nothing more appears and the list simply ends. (Changed after the user's review on 2026-11-18: no end-of-list line.)
19. A sort control switches between **Mới nhất** (newest first, the default) and **Cũ nhất** (oldest first). Changing it goes back to the first 5. The phone remembers the choice.
20. Each comment is a rounded bubble with the author's avatar initial and name, then the text. Below the bubble: the time and, on one's own comments, "Sửa · Xoá". Comments are 16pt apart.
21. A bell sits on the right of each comment. On: orange bell with the word "Nhắc". For involved people, an off flag shows a grey outlined bell they can tap; for others, an off flag shows nothing and an on flag can't be tapped.
22. The write field sits at the top of the section. While typing, it stays above the keyboard. Involved people also see a "Nhắc kèm" toggle there, off by default and off again after sending. A new comment appears at its place in the current order.
23. "Sửa" turns the bubble into a text field with "Huỷ · Lưu". "Lưu" is disabled while the text is empty.
24. Over 1000 characters, sending is disabled and a red message says how many characters to remove.
25. With no comments, the section shows one inviting line and the write field.
26. Everything works in light and dark mode, with the tokens in `DESIGN.md`, VI and EN text, touch targets of at least 44pt, and accessible names on the bell and icon buttons.

### Data

27. A database migration adds comments. It applies to an empty database and to one with existing data.

## Acceptance Criteria

1. API test: a member adds a comment; it comes back with author, time and trimmed text. Empty, whitespace-only and 1001-character text is refused with `validation_failed`.
2. API test: the author edits the text; the comment reports that it was edited. Only flipping the flag leaves it not edited.
3. API test: the author deletes a comment; it's no longer listed.
4. API test: another member and an Owner each get `403` when editing or deleting someone else's comment.
5. API test: the 501st comment on a task is refused with a distinct error code.
6. API test: deleting a task removes its comments. Unit test: a comment with no author maps to the neutral name.
7. API test: the creator and an assignee can set and clear the flag on another member's comment, and can create a comment with the flag on.
8. API test: a member who isn't involved gets `403` when setting the flag on create and on edit.
9. API test: listing comments returns the flag for every comment.
10. API test: after an assignee is removed from the task, a flag they set stays on.
11. API test: a signed-out request gets `401`; a non-member gets `404` for list, create, edit and delete.
12. API test: an older edit than the stored one doesn't overwrite it, for text and for the flag. Editing a deleted comment gets `404`.
13. API test: creating the same id twice on one task gives one comment; the same id on another task gets `409`.
14. By hand: comments seen on a task stay readable with the phone offline.
15. Unit test: queued comment changes merge per comment (create then delete leaves nothing; two edits leave one). By hand: offline, add a comment, see "Chờ gửi", restart the app, go online, it sends.
16. Unit test: a permanently refused comment change produces the "Couldn't send" state with retry and discard.
17. By hand, against the mockup: the Bình luận section sits below Checklist with the count, and there is no separate screen.
18. By hand: comments come 5 at a time; "Xem thêm bình luận (N)" loads 5 more; nothing more appears once all are shown. Unit test: batching.
19. By hand: switching Mới nhất / Cũ nhất goes back to the first 5 and is remembered after restarting the app. Unit test: sorting.
20. By hand: bubble layout with avatar, name, text, time and "Sửa · Xoá" on one's own comments only, 16pt apart.
21. By hand: bell states for an involved member (grey outline tappable, orange "Nhắc" when on) and a non-involved member (nothing when off, not tappable when on). Unit test: bell states.
22. By hand: the write field stays above the keyboard; the "Nhắc kèm" toggle shows only for involved people and resets after sending; a new comment lands in the current order.
23. By hand: inline edit with Huỷ · Lưu; Lưu is disabled while empty.
24. By hand: over 1000 characters disables sending and shows how many characters to remove. Unit test: length check.
25. By hand: with no comments, one inviting line and the write field.
26. By hand: light and dark mode, VI and EN, VoiceOver names on the bell and send button.
27. Check: `prisma migrate deploy` succeeds on an empty test database and on one with existing tasks.

## Out of Scope

- Sending reminders, and putting "Nhắc kèm" comments into reminder push (#10).
- Push notifications for new comments (#16).
- Photos on tasks (#9) and on comments; @mentions; reactions; replies to comments.
- Comments on ideas (#11).
- Owners moderating other people's comments.
- A comment count on the task list.

## Open Questions

None.
