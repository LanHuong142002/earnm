# Change Report: Members can record ingredients and their unit cost (#12)

## Summary

Adds a per-project ingredients list (weight/volume/portion), with purchase quantity and price, unit cost per 1 and per 10, a total spent, a default flag and the last 5 prices.
Partners enter what they paid once and the app works out what each gram, ml or portion costs; #13 builds cup costs on it.
Verified by API tests (662 pass), mobile tests (1034 pass), lint and build; two reviewers plus a fix re-review; QA against the 19 acceptance criteria.
Watch: money is stored as integer minor units of the project currency, so the project currency is now locked once ingredients exist (409 currency_locked).
Left: on-device checks of the screens and the migration on a database with real data (Test Handoff, ticket #47 section F).

## Details

**Decisions:** money as integer minor units and quantities in base units; purchase (quantity+unit+price) is one last-write-wins field and writes a history row only when it wins and changes quantity or price; limits 300 ingredients, name 60, unique per project; blocking delete of a used ingredient moved to #13; flat accentStrong total card (no gradient library); Lưu as a bottom button; currency locked once ingredients exist.

**Review:** round 1 found two blocking issues, both fixed in `2a04a35`: a mode/unit mismatch when mode and purchase won last-write-wins separately (now rolled back with 409 `ingredient_mode_conflict`), and currency changes reinterpreting stored prices (now 409 `currency_locked`). Also fixed: USD prices with >2 decimals are refused instead of rounded; a create name race returns 409 instead of 500. Round 2 (fix commit only) found nothing blocking.

**Non-blocking, left as is:** a taken name in an offline edit rejects the other fields of that same edit (shown as rejected); another project's id gives 409 `id_conflict` (as ideas); the server trusts `purchase.quantity` is in base units; the currency check and LWW read the clock separately.

**QA:**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | API test: a member creates an ingredient in each mode; empty or 61-character name, duplicate name (case-insensitive), quantity 0, negative price and an unknown mode are refused. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 2 | Unit test: kg→g and l→ml conversion; base quantity with 3 decimals. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 3 | API test: price stored as an integer; above-maximum values refused. Unit test: VND and USD minor units. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 4 | Unit test: unit-cost formatting per 1 (2 decimals) and per 10 (whole), VND and USD, e.g. 24.000 ₫ / 380 g → 63,16 ₫/g and 632 ₫/10 g. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 5 | API test: another member edits and deletes; deleting the project deletes its ingredients and history. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 6 | API test: the 301st ingredient is refused with `ingredient_limit_reached`. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 7 | API test: create records one history entry; changing price adds one; renaming adds none. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 8 | API test: after 7 purchase changes only the latest 5 entries remain, newest first. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 9 | API test: older edits don't overwrite newer per field and a stale purchase adds no entry; same id twice gives one ingredient; non-member `404`; signed out `401`. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 10 | Unit test: total sums the current price of each ingredient. | API/mobile vitest passed (662 API, 1034 mobile); QA subagent read the named tests | ✅ pass |
| 11 | By hand, mockup 1a: tile with count; Sản phẩm still "Sắp có". | Phone only: project tile 'n loại', Sản phẩm still Sắp có (mockup 1a); #47 section F | 🙋 by hand |
| 12 | Unit test: A–Z Vietnamese sort. By hand, mockup 1b: hero and row layout. | Unit test sort passed; layout vs mockup 1b on phone (#47 F) | 🙋 by hand |
| 13 | By hand, mockups 1c–1d: fields per mode, live result, default switch. | Form state unit tests passed; per-mode fields vs mockups 1c-1d on phone (#47 F) | 🙋 by hand |
| 14 | Unit test: form validation messages. By hand, mockup 1e. | validate.test passed; error placement vs mockup 1e on phone (#47 F) | 🙋 by hand |
| 15 | By hand, mockup 1f: history section collapsed by default, current entry marked; delete confirmation. | History collapsed, 'đang dùng', delete confirm vs mockup 1f on phone (#47 F) | 🙋 by hand |
| 16 | By hand, mockups 1h–1i. | Empty/loading/error vs mockups 1h-1i on phone (#47 F) | 🙋 by hand |
| 17 | Unit test: queued ingredient changes merge per field. By hand: offline create shows "Chờ lưu" and syncs after reconnect. | Merge unit test passed; offline Chờ lưu and sync on phone (#47 F) | 🙋 by hand |
| 18 | By hand: dark mode, EN text, VoiceOver row labels. | Dark mode, EN, VoiceOver on phone (#47 F) | 🙋 by hand |
| 19 | Check: `prisma migrate deploy` succeeds on an empty test database and on one with existing data. | Migration applied on test DB from empty; additive schema test passed; deploy on DB with existing data not run | 🙋 by hand |

**Not verified:** no screen was opened on a device or simulator; `prisma migrate deploy` was not run on a database holding real data.
