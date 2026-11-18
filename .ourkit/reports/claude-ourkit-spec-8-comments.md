# Change Report: Members can comment on tasks (#8)

## Summary

What changed: tasks have a Bình luận section with bubble comments, 5 at a time, Mới nhất/Cũ nhất sort, inline edit and delete, and a "Nhắc kèm" bell that involved people (creator + assignees) can switch.
Why: partners need notes on a task that travel with its reminders later (#10, Decision 5); the user shaped the screen at the mockup review.
How it was verified: API 441 and mobile 642 tests pass, lint and build pass, two reviews (general and Sensitive Areas), QA of 27 criteria with 15 passed and 12 by hand.
What to watch for: permission rules on the server (author-only text, involved-only flag), the new migration, and how the inline write field behaves above the keyboard.
What's left: on-device checks in the Test Handoff, and four non-blocking findings about rare offline edge cases.

## Details

**Built**
- API: `TaskComment` table (migration `20261117100000_task_comments`), router under `/projects/:projectId/tasks/:taskId/comments` (list, create, patch, delete), `isInvolved` helper. Membership 404 everywhere, author-only edit/delete with no Owner exception, involved-only flag, 500 per task, idempotent create, per-field last-write-wins.
- Phone: `tasks/comments/` data layer (per-task cache, queue entity, overlay with waiting/failed states, retry/discard) and UI (`CommentsSection`, `CommentBubble`, `CommentBell`, `CommentComposer`), inserted after Checklist on the task screen; 49 VI/EN strings.

**Decisions** (Decision Log): involved = creator + assignees; one bounded list per task with paging on the phone; max 500 comments; author-only edit/delete; failures shown on the comment itself; mockup departures: native sort sheet, inline composer, "Đã xem hết" only above 5 comments; the user's hands-off request was read as approving the plans.

**Review**
- General review: 3 blocking. Fixed: sort change now returns to the first 5; comment actions are 44pt wide. Resolved by design: the comment list isn't server-paged (approved plan, 500 cap). Non-blocking fixed: retry of a refused create drops the flag, unused cache helper removed, composer catches send errors.
- Sensitive Areas review: nothing blocking. Open non-blocking: (8) an offline text edit merged with a flag change is refused as a whole if the author stopped being involved, and Retry repeats it; (9) Retry drops the flag even for refusals other than "forbidden"; (10) a create replayed after a lost response can bring back a comment deleted from another phone; (11) a missing comment answers "Project not found."
- Open non-blocking from the general review: (4) "Đã xem hết bình luận" shows only above 5 comments.

**QA**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | API test: a member adds a comment; it comes back with author, time and trimmed text. Empty, whitespace-only and 1001-character text is refused with `validation_failed`. | API suite (441 passed): 'creates and lists a comment with its author…' and 'rejects empty, blank, 1001-character and extra-field bodies with validation_failed' | ✅ pass |
| 2 | API test: the author edits the text; the comment reports that it was edited. Only flipping the flag leaves it not edited. | API test 'sets edited only when the text changes, not the flag' passed | ✅ pass |
| 3 | API test: the author deletes a comment; it's no longer listed. | API tests on author delete and '404 for edits and deletes of a comment that is gone' passed | ✅ pass |
| 4 | API test: another member and an Owner each get `403` when editing or deleting someone else's comment. | API test 'another member and an Owner get 403' passed | ✅ pass |
| 5 | API test: the 501st comment on a task is refused with a distinct error code. | API test 'refuses the 501st comment with comment_limit_reached' passed | ✅ pass |
| 6 | API test: deleting a task removes its comments. Unit test: a comment with no author maps to the neutral name. | API test 'deletes the comments with the task and nulls the author…' passed; unit test returns 'Người dùng cũ'; DB check: deleting a task removed its comment | ✅ pass |
| 7 | API test: the creator and an assignee can set and clear the flag on another member's comment, and can create a comment with the flag on. | API test 'lets only involved people set the flag, on create and on patch' passed for creator and assignee | ✅ pass |
| 8 | API test: a member who isn't involved gets `403` when setting the flag on create and on edit. | Same API test: a non-involved member gets 403 on create and patch | ✅ pass |
| 9 | API test: listing comments returns the flag for every comment. | API test 'shows flags to every member and keeps them after the person stops being involved' passed | ✅ pass |
| 10 | API test: after an assignee is removed from the task, a flag they set stays on. | Same API test: the flag stays after the assignee is removed | ✅ pass |
| 11 | API test: a signed-out request gets `401`; a non-member gets `404` for list, create, edit and delete. | API tests 'answers 401 without a valid session' and '404 not_found to a non-member on every route' passed | ✅ pass |
| 12 | API test: an older edit than the stored one doesn't overwrite it, for text and for the flag. Editing a deleted comment gets `404`. | API tests on older text edits, per-field last-write-wins for text and flag, and 404 on a deleted comment passed | ✅ pass |
| 13 | API test: creating the same id twice on one task gives one comment; the same id on another task gets `409`. | API tests 'idempotent on the same id and 409 on an id used by another task' and concurrent create passed | ✅ pass |
| 14 | By hand: comments seen on a task stay readable with the phone offline. | Needs a device: open a task online, go offline, reopen it | 🙋 by hand |
| 15 | Unit test: queued comment changes merge per comment (create then delete leaves nothing; two edits leave one). By hand: offline, add a comment, see "Chờ gửi", restart the app, go online, it sends. | Unit tests passed (create+delete sends nothing, two edits one request); offline send and restart need a device | 🙋 by hand |
| 16 | Unit test: a permanently refused comment change produces the "Couldn't send" state with retry and discard. | Mobile sync.test.ts: refused change kept as failed with retry and discard; overlay shows failed state (642 passed) | ✅ pass |
| 17 | By hand, against the mockup: the Bình luận section sits below Checklist with the count, and there is no separate screen. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 18 | By hand: comments come 5 at a time; "Xem thêm bình luận (N)" loads 5 more; "Đã xem hết bình luận" appears when all are shown. Unit test: batching. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 19 | By hand: switching Mới nhất / Cũ nhất goes back to the first 5 and is remembered after restarting the app. Unit test: sorting. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 20 | By hand: bubble layout with avatar, name, text, time and "Sửa · Xoá" on one's own comments only, 16pt apart. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 21 | By hand: bell states for an involved member (grey outline tappable, orange "Nhắc" when on) and a non-involved member (nothing when off, not tappable when on). Unit test: bell states. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 22 | By hand: the write field stays above the keyboard; the "Nhắc kèm" toggle shows only for involved people and resets after sending; a new comment lands in the current order. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 23 | By hand: inline edit with Huỷ · Lưu; Lưu is disabled while empty. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 24 | By hand: over 1000 characters disables sending and shows how many characters to remove. Unit test: length check. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 25 | By hand: with no comments, one inviting line and the write field. | Needs a device against the mockup; static check: CommentsSection mounted after Checklist; unit tests for batching, sort, bell, length passed | 🙋 by hand |
| 26 | By hand: light and dark mode, VI and EN, VoiceOver names on the bell and send button. | Needs a device: light/dark, VI/EN, VoiceOver; static check: accessibilityLabel on bell, send, sort, edit, toggle | 🙋 by hand |
| 27 | Check: `prisma migrate deploy` succeeds on an empty test database and on one with existing tasks. | prisma migrate deploy applied all 8 migrations to an empty scratch DB, and the comments migration to a scratch DB with a project and task; data intact, defaults correct | ✅ pass |

**Not verified here:** everything marked by hand above (on a phone against the mockup, offline flow, light/dark, VI/EN, VoiceOver). The spec's acceptance criteria were renumbered one per line during QA so each could be tracked; their content didn't change.
