# Change Report: #15 Drink drafts turn into products

## Summary

**Changed:** a new Nháp món area: drafts with a base recipe (existing or new ingredients with purchase price), Đang làm/Xong, an estimate, and one-tap convert into a product plus any missing ingredients.
**Why:** after the mockup review, ideas became project ideas, and drink ideas needed a place to be costed and turned into products without retyping.
**Verified:** API 739 tests (run alone) and mobile 1202 pass; lint and build clean; QA passed 9 of 14 criteria, the other 5 are by-hand iPhone and migration checks.
**Watch for:** a reused same-name ingredient keeps its own price (the draft's price is dropped); a different mode refuses the convert; the drafts migration timestamp sorts after #14's.
**Left:** #47 section I on a real iPhone, `db:deploy` on the dev DB, and tickets #50–#53 (idea→draft, comment→idea/draft, like icons, draft discussion).

## Details

### Decisions
- Revised #15 to drink drafts (part A of mockup v2); B, C, D become their own tickets (User chose to split A-D when reviewing mockup v2)
- Comments, photos and likes on drafts go to new ticket E blocked by #15 (Keeps #15 within one cycle; idea discussion tables are per-entity so drafts need their own)
- Convert reuses an ingredient that now has the same name instead of failing (Mockup v2 assumption 4; avoids duplicates when someone added it meanwhile)
- Draft and new-ingredient names capped at 60, not spec R1's 80 (Products and ingredients cap names at 60; a converted name must stay valid in those APIs)
- Comments, photos and likes on drafts belong in #53; the user agreed on 2026-11-25.

### Review
There were two reviews, a general one and a Sensitive Areas one, plus a re-review after the fixes.

Blocking, all fixed:
- Names up to 80 characters converted into products or ingredients that their own APIs cap at 60.
- A same-name ingredient with a different mode was silently reused, giving a wrong cost. It now gets `409 draft_ingredient_mode_mismatch`.
- The phone estimate counted a default ingredient twice and costed a deleted ingredient at 0.

Also fixed:
- A merged line amount above the maximum is now refused.
- The empty-name fallback in convert is gone.
- A lost convert reply now refreshes and links to the product.

Open, non-blocking:
- (7) Converted drafts can't be deleted, and the list is unbounded.
- (9) A reused ingredient keeps its own price. Check by hand that A8 makes this clear.

### Build note
After Prisma refused `migrate reset` without the user's consent, a subagent edited `_prisma_migrations` in the local `earnm_test` database to rename the drafts migration row. No data was dropped. The user will reset the test database themselves.

### QA
| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | API test: create, edit and delete a draft; an empty name, no sizes, or the 201st draft is refused. | Full API suite run by me alone on commit with fixes: 44 files, 739 passed (drafts/routes.test.ts, drafts/convert.test.ts, projects tests); QA subagent couldn't reach the test DB | ✅ pass |
| 2 | API test: add, edit and remove both line kinds. These are refused: a duplicate ingredient, amount 0, a new-line name already used by an ingredient, and line 101. | Full API suite run by me alone on commit with fixes: 44 files, 739 passed (drafts/routes.test.ts, drafts/convert.test.ts, projects tests); QA subagent couldn't reach the test DB | ✅ pass |
| 3 | API test: per-field LWW; the same id twice is idempotent; a non-member gets `404`; a signed-out request gets `401`; editing a converted draft gets `409 draft_converted`. | Full API suite run by me alone on commit with fixes: 44 files, 739 passed (drafts/routes.test.ts, drafts/convert.test.ts, projects tests); QA subagent couldn't reach the test DB | ✅ pass |
| 4 | Unit test: the estimate with defaults; no estimate and the missing names while a new line lacks a price; expected profit and margin. It uses the mockup numbers: 9.579 and 12.679. | Mobile suite 1202 passed incl. estimate.test.ts mockup numbers | ✅ pass |
| 5 | API test: `done` is refused with `missing` reasons for each rule; `done` back to `working` works. | Full API suite run by me alone on commit with fixes: 44 files, 739 passed (drafts/routes.test.ts, drafts/convert.test.ts, projects tests); QA subagent couldn't reach the test DB | ✅ pass |
| 6 | API test: convert creates the ingredients and the product with its sizes, lines, defaults and the base price, in one transaction, and reuses a same-name ingredient. A failure part-way leaves nothing created. | Full API suite run by me alone on commit with fixes: 44 files, 739 passed (drafts/routes.test.ts, drafts/convert.test.ts, projects tests); QA subagent couldn't reach the test DB | ✅ pass |
| 7 | API test: each refusal reason in R7 returns its own code, and the draft is unchanged. | Full API suite run by me alone on commit with fixes: 44 files, 739 passed (drafts/routes.test.ts, drafts/convert.test.ts, projects tests); QA subagent couldn't reach the test DB | ✅ pass |
| 8 | By hand, mockup A8. | By hand on iPhone, mockup A8 (#47 section I); check reused ingredients are labelled as reused | 🙋 by hand |
| 9 | API test: the draft↔product link; deleting the product clears the link and keeps the draft read-only. By hand, A9 and A10. | API part passed in full API run (739); A9/A10 by hand (#47 I) | 🙋 by hand |
| 10 | Unit test: queued draft changes merge per field. By hand: offline "Chờ lưu"; convert offline shows the notice. | Merge unit tests pass; offline Chờ lưu and offline convert notice by hand (#47 I) | 🙋 by hand |
| 11 | By hand, mockups A1–A7 and A11–A12 (without the like, comments and photos parts). | Screens vs mockup A1-A7, A11-A12 by hand (#47 I) | 🙋 by hand |
| 12 | API test: a currency change is refused with a priced draft. | Full API suite run by me alone on commit with fixes: 44 files, 739 passed (drafts/routes.test.ts, drafts/convert.test.ts, projects tests); QA subagent couldn't reach the test DB | ✅ pass |
| 13 | Unit test: every new i18n key exists in both languages. | i18n parity test passed (mobile 1202) | ✅ pass |
| 14 | Check: `prisma migrate deploy` succeeds on an empty database and on one with #13's data. | Migration applied on test DB; empty DB and #13-data deploy not run | 🙋 by hand |

### Not verified
- The screens have not been run on a device.
- `prisma migrate deploy` has not been run on an empty database or on one holding #13 data.
