# Change Report: Members can collect, discuss and vote on ideas (#11)

## Summary

Each project now has an ideas board: ideas with title, description, labels and photos, up/down votes, comments, statuses New / Considering / Accepted / Dropped, and an accepted idea becomes a task with assignees and a due date.
It answers ticket #11 (Epic F10, Decision 11), so the group can decide together what to try next.
Verified by API and unit tests (`gate run test`: API 549, mobile 854 passing), lint and build passing, two reviews plus a Sensitive Area review, and QA against the spec (13 criteria pass by test, 11 need an iPhone, none failed).
Watch for: the phone's task comments and photos components were refactored to serve ideas too, and the migration `20261118130000_ideas` must stay after #10's migrations if #10 merges first.
Left: hand checks on an iPhone (#44) and copying an idea's photos to its task (#43).

## Details

**Decisions**
- Ideas have their own comment, photo, label-join and vote tables; task tables stay untouched.
- Any member changes status; the author and the Owner edit, delete and manage photos.
- Order: score (ups minus downs), then newest; one anonymous vote per member, own idea allowed; dropped ideas collapsed at the end.
- One task per idea, created on the server in one transaction. Photos are not copied (user, 2026-11-18; #43).
- The task-from-idea form has editable title and description, labels, **Giao cho** and **Hạn chót** (user's decision after review, matching mockup 2d).
- On the phone, `CommentsSection` and `PhotosSection` take a `parent` adapter (task or idea) instead of a task id; idea comments have no "Nhắc kèm" bell.
- New idea: photos are added after the first save (an idea must exist first); the edit screen has the full Ảnh section.

**Review**
- First review: no findings. Sensitive Area review: no blocking; four non-blocking, all handled at the user's request: a refused photo record now cleans up its upload; idea and idea-photo deletes await image destruction (bounded to 5 s); the destroy-after-idea-deleted path is documented and tested to need a member; idempotent re-create replays are documented and tested.
- Re-review of those fixes found one blocking bug (a member could make the server destroy another person's recorded image by re-recording its id); fixed: an image owned by a recorded photo is never destroyed, with a test.

**QA**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | Create; validation | routes.test.ts | ✅ pass |
| 2 | Author/Owner edit and delete | routes.test.ts | ✅ pass |
| 3 | Any member changes status | routes.test.ts | ✅ pass |
| 4 | 500-idea limit | routes.test.ts | ✅ pass |
| 5 | Delete cascades and image cleanup | routes.test.ts | ✅ pass |
| 6 | Label delete; neutral author | routes.test.ts, mobile unit test | ✅ pass |
| 7 | LWW, idempotent, 404/401 | routes.test.ts | ✅ pass |
| 8 | Votes | routes.test.ts | ✅ pass |
| 9 | Score and own vote only | routes.test.ts | ✅ pass |
| 10 | Idea comments | API pass; section without bells by hand | 🙋 by hand |
| 11 | Idea photos | photos.test.ts incl. the review fix | ✅ pass |
| 12 | Create-task button and prefilled form | prefill unit test; form on an iPhone (#44) | 🙋 by hand |
| 13 | Create task from idea | toTask.test.ts (assignees, due, fallback, once only) | ✅ pass |
| 14 | Link clearing | toTask.test.ts | ✅ pass |
| 15 | Needs network offline | mobile unit test | ✅ pass |
| 16 | Project tile with New count | count unit test; tile by hand | 🙋 by hand |
| 17 | Ordering, filters, list layout | listRules.test.ts; layout by hand | 🙋 by hand |
| 18 | Empty, loading, error | by hand | 🙋 by hand |
| 19 | Idea screen, status sheet, link | canEditAs unit test; screens by hand | 🙋 by hand |
| 20 | New and edit forms | by hand | 🙋 by hand |
| 21 | No tick marks | by hand | 🙋 by hand |
| 22 | Offline queue | sync.test.ts; offline by hand | 🙋 by hand |
| 23 | Dark mode, EN, VoiceOver | label unit test; by hand | 🙋 by hand |
| 24 | Migration applies | additive SQL; applied by the test setup | ✅ pass |

**Not verified:** nothing has run on a phone (all screens, offline, dark mode, VoiceOver, the shared task comments/photos components); `prisma migrate deploy` was not run separately on a database with existing data. The step-by-step checks are in #44 (the earlier Test Handoff text that says the form has no Giao cho/Hạn chót is out of date).
