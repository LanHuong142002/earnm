# Change Report: Members can build products and see the cost of each cup (#13)

## Summary

Adds products with S/M/L sizes, each with a recipe, extra costs and a selling price, showing cost, profit, margin and a quiet price hint for a project target margin.
Partners see what each drink costs to make and set prices that make a profit; costs follow current ingredient prices from #12.
Verified by API tests (708 pass), mobile tests (1120 pass), lint and build; two reviewers; QA against the 23 acceptance criteria.
Watch: the project currency is now also locked once extra costs, size extras or selling prices exist; a used ingredient can't be deleted (409 ingredient_in_use).
Left: on-device checks of every screen and the migration on a database with #12 data (Test Handoff, ticket #47 section G).

## Details

**Decisions:** only inputs are stored and costs are computed on the phone from current prices; default lines start ticked with amount 1 for portion and 0 otherwise, and are tappable to set the amount; project extra costs are copied into a size and later changes don't touch existing sizes; hint rounds up to 1.000 VND or 0,10 USD with a 1–95% target (default 65) that any member can change; non-default extras can be removed from a size; ingredient delete is checked locally first, with the server 409 as the guard.

**Review:** one blocking issue, fixed: the currency lock only counted ingredients (now also extra costs, size extras and selling prices). Non-blocking, left: a stale losing edit can be refused before last-write-wins (shown as rejected); cross-project id gives `id_conflict`; size lines and extras are replaced on each winning write.

**QA:**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | API test: create with name and sizes; empty/duplicate name and no sizes refused; rename, remove a size (not the last), delete keeps ingredients. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 2 | API test: the 201st product is refused with `product_limit_reached`. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 3 | API test: selling price stored as integer; out-of-range refused. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 4 | API test: recipe line with a foreign ingredient, duplicate ingredient or amount 0 on a non-default line refused. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 5 | API test: a new size gets ticked default ingredient lines (portion amount 1, others 0); unticking works; removing a default line refused. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 6 | API test: a new size copies default extra costs; changing the project extra cost leaves the size unchanged; 51st extra cost refused. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 7 | API test: marking an ingredient default later doesn't change existing sizes. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 8 | API test: deleting a used ingredient returns `409 ingredient_in_use` with product names. By hand, mockup 1g. | API in_use 409 with names passed; dialog 1g on phone (#47 G) | 🙋 by hand |
| 9 | Unit test: line and size cost with rounding; unticked lines excluded. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 10 | Unit test: profit and margin; no-price case. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 11 | Unit test: hint rounding VND to 1.000 and USD to 0,10; target 1–95 enforced (API test). | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 12 | Unit test: cost recomputes after an ingredient price change and the update line names the latest one. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 13 | API test: per-field LWW for name, sizes, price and recipe list; same id twice idempotent; non-member `404`; signed out `401`. | API 708 / mobile 1120 vitest passed; QA subagent read the named tests | ✅ pass |
| 14 | Unit test: queued product changes merge per field. By hand: offline "Chờ lưu" then sync. | Sync/overlay unit tests passed; offline Chờ lưu on phone (#47 G) | 🙋 by hand |
| 15 | By hand, mockup 1a: Sản phẩm tile enabled with count. | Phone only vs mockup group 2 / 1a (#47 section G) | 🙋 by hand |
| 16 | Unit test: list order and which size is summarised. By hand, mockup 2a. | Phone only vs mockup group 2 / 1a (#47 section G) | 🙋 by hand |
| 17 | By hand, mockups 2b and 2g′. | Phone only vs mockup group 2 / 1a (#47 section G) | 🙋 by hand |
| 18 | By hand, mockup 2c. | Phone only vs mockup group 2 / 1a (#47 section G) | 🙋 by hand |
| 19 | By hand, mockups 2d, 2e, 2f. | Phone only vs mockup group 2 / 1a (#47 section G) | 🙋 by hand |
| 20 | By hand, mockup 2g: round size pills. | Phone only vs mockup group 2 / 1a (#47 section G) | 🙋 by hand |
| 21 | By hand, mockup 2h. | Phone only vs mockup group 2 / 1a (#47 section G) | 🙋 by hand |
| 22 | By hand, mockups 2i, 2j, 2k; EN text; VoiceOver. | Phone only vs mockup group 2 / 1a (#47 section G) | 🙋 by hand |
| 23 | Check: `prisma migrate deploy` succeeds on an empty test database and on one with #12's data. | Migrations applied on test DB; deploy on DB with #12 data not run | 🙋 by hand |

**Not verified:** no screen was opened on a device; `prisma migrate deploy` not run on a database with #12 data.
