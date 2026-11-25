# Change Report: #14 Fixed costs are shared across the price of each cup

## Summary

**Changed:** projects get fixed costs (monthly, weekly, or one-time over N months) and expected cups per month; product profit, margin and price hint now use recipe + extras + per-cup share.
**Why:** prices must cover rent, wages and equipment, not only ingredients (Epic Decisions 9, 10).
**Verified:** API 723 and mobile 1388 tests pass, lint and build clean; QA passed 10 of 15 criteria, the other 5 are by-hand checks on a real iPhone.
**Watch for:** deploy the API before the app (new app + old API shows empty product lists); shown profit drops once the share is set, as intended.
**Left:** the by-hand checks in #47 section H, `db:deploy` on the dev DB with #13 data, and non-blocking findings 3, 4, 7, 8, 9.

## Details

### Decisions
- The phone does the fixed-cost maths; the API stores only the items and the cups, so no backfill is ever needed.
- It reuses the extra-costs route, overlay and sync pattern, and the targetMargin field pattern for the cups.
- Monthly amounts round half up per item. The share is the total ÷ cups, rounded to the smallest currency unit.
- A one-time item keeps being spread until it is deleted. The user confirmed this on 2026-11-25.

### Review
Two reviews, a general one and a Sensitive Areas one, plus two re-reviews after fixes.

Blocking, fixed:
- A stale kind change could leave a one-time item with no months, which made its monthly amount 0.
- A stale kind or months edit could reject a whole queued PATCH, losing newer name or amount edits in the same request. Kind and months now resolve per field, keeping the invariant that a one-time item always has months.

Non-blocking, open:
- (3) A long assertion line in `projects/routes.test.ts`.
- (4) Existing projects get `expectedCupsEditedAt` set to the migration time. This is the same pattern as targetMargin.
- (7) Deploy order, as above.
- (8) A stale rename to a name that is now taken still rejects the whole PATCH.
- (9) A retried create recreates an item another member deleted. This is the same behaviour as extra costs and products.

### QA
| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | API test: create, rename, change kind/amount/months, delete an item; empty or duplicate name, amount 0, N outside 1–120, N on a non-oneTime item refused with `400`. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 2 | API test: the 51st item is refused with `fixed_cost_limit_reached`. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 3 | Unit test: monthly amount per kind with rounding (600.000 weekly → 2.600.000; 18.000.000 over 24 → 750.000) and total. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 4 | API test: cups set, changed, cleared; 0 and 1.000.001 refused. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 5 | Unit test: share 8.600.000 ÷ 1.500 = 5.733; no share when cups unset or total 0; USD rounds to cents. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 6 | Unit test: full cost, profit, margin and hint use the share (Trà sữa M: 16.768, 18.232, 52%, hint 48.000); without a share they equal #13's results. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 7 | Unit test: two sizes of different products get the same share. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 8 | API test: per-field LWW on item fields and cups; same id twice idempotent; non-member `404`; signed out `401`. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 9 | Unit test: queued item and cups changes merge per field. By hand: offline "Chờ lưu" then sync. | Merge unit tests pass; offline Chờ lưu by hand on phone (#47 H) | 🙋 by hand |
| 10 | By hand, mockup 1a. | App not run; compare on real iPhone with mockup (#47 section H) | 🙋 by hand |
| 11 | By hand, mockups 1b–1k. | App not run; compare on real iPhone with mockup (#47 section H) | 🙋 by hand |
| 12 | By hand, mockups 2a–2d. | App not run; compare on real iPhone with mockup (#47 section H) | 🙋 by hand |
| 13 | API test: currency change refused with a fixed cost item present. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 14 | Unit test: every new i18n key exists in both languages. | API fixedCosts+projects 43 passed; mobile products+i18n 350 passed; full gate 723/1388 earlier; QA subagent read the named tests | ✅ pass |
| 15 | Check: `prisma migrate deploy` succeeds on an empty database and on one with #13's data. | Migration applied on test DB; empty DB and #13-data deploy not run | 🙋 by hand |

### Not verified
- The screens have not been run on a device or simulator.
- `prisma migrate deploy` has not been run on an empty database or on one holding #13 data. The test database applied the migration.
