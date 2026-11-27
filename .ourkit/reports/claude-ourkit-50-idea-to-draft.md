# Change Report: An accepted idea can become a drink draft (#50)

## Summary

An idea in Đã chọn can create one linked drink draft, prefilled from it, with its photos copied; drafts now have their own photos.
Partners turn an agreed idea into a recipe in one step (ticket #50), replacing the old idea → product path.
Verified by API tests (930/930), mobile tests (1576/1576), lint and build; two review rounds, including the Sensitive reviewer.
Watch the first real Cloudinary copy (only fakes were used in tests) and the new migration `20261127120000_draft_idea_photos`.
Left: phone checks in #47 section L, one open question (draft note limit 500 vs 2000), #51 (PR #58) stacks on this branch.

## Details

**Decisions**
- The link lives on the draft (`Draft.ideaId`, unique, `ON DELETE SET NULL`), so deleting either side clears it without extra code.
- Creating from an idea needs a connection, like creating a task from an idea.
- Photos: any member adds; the adder or an Owner edits captions and deletes; nothing changes once the draft is converted.
- A failed copy still creates the draft and reports how many photos were not carried over; copies made by a request are destroyed if they can't be recorded.
- The prefilled note is cut to 500, the app draft form's limit (open question).
- Sizes start as on the normal New draft form (M).

**Review**
- Sensitive review found one blocking issue: any member could destroy the image of a photo copied from an idea through the record route's limit branch, because copied rows used a different id from their storage id. Fixed: one id for both, an ownership check in the limit branch, and step 3 under the project lock with a re-check of membership, draft state and the 10-photo cap.
- A later review found prefills cut by characters while the form and server count UTF-16 units; fixed.
- Non-blocking, left: a retry with the same draft id gets `409 idea_already_has_draft` (the app recovers by refreshing); a caller removed during the copy window still gets 201; step 3 has no `withRetry`.

**QA**

| # | Criterion | Checked by | Result |
|---|---|---|---|
| 1 | Button only on Đã chọn ideas | API and unit tests | ✅ pass |
| 2 | Prefilled form | Unit tests | 🙋 by hand |
| 3 | Create, link, copied photos | API tests | ✅ pass |
| 4 | Refusals and concurrency | API tests | ✅ pass |
| 5 | Offline message | Code | 🙋 by hand |
| 6 | Links both ways, after conversion | API and unit tests | 🙋 by hand |
| 7 | Deleting either side | API tests | ✅ pass |
| 8 | Link kept on status change | API test | ✅ pass |
| 9 | Draft photos on the phone | API tests | 🙋 by hand |
| 10 | Adder or Owner only | API tests | ✅ pass |
| 11 | Converted draft photos read-only | API tests | ✅ pass |
| 12 | Photo cleanup on delete | API tests | ✅ pass |
| 13 | Copy failure notice | API tests, code | 🙋 by hand |
| 14 | Copies cleaned up on failure | API tests | ✅ pass |
| 15 | Tests, lint, build | Gates | ✅ pass |

**Not verified:** anything on a phone, and a real Cloudinary copy.
