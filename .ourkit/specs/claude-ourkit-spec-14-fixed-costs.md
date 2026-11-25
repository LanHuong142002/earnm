# Spec: #14 Fixed costs are shared across the price of each cup

Ticket: https://github.com/LanHuong142002/earnm/issues/14 · Mockup: `.ourkit/mockups/claude-ourkit-spec-14-fixed-costs.html` (approved 2026-11-20)

## Goal

A project can list its fixed costs (rent, wages, equipment) and an expected number of cups per month. The monthly total divided by the cups becomes a per-cup share that is added to every product's cost, so the profit, margin and price hint on products show the full cost of a cup, not only ingredients and extras (Epic Decisions 9, 10).

## Requirements

1. A project has a list of fixed cost items. Each has a name (1–80 characters, unique in the project, case-insensitive), a kind (`monthly`, `weekly` or `oneTime`), an amount (integer, smallest currency unit, 1 to the project's existing maximum price) and, for `oneTime` only, a number of months N (1–120).
2. A project holds at most 50 fixed cost items.
3. Each item's monthly amount is: `monthly` → amount; `weekly` → amount × 52 ÷ 12; `oneTime` → amount ÷ N; rounded to the currency's smallest unit (half up). The monthly total is the sum of the rounded item amounts.
4. A project has an optional expected cups per month (integer 1–1.000.000, or not set). It starts not set.
5. When cups are set and the total is above 0, the per-cup share is total ÷ cups, rounded to the smallest unit. Otherwise there is no share.
6. A product size's full cost is its current cost (#13: recipe + extras) plus the share. Profit, margin, the "under target" note and the price hint all use the full cost when a share exists; without a share they behave as in #13 and say "chưa tính chi phí cố định".
7. Every size of every product carries the same share.
8. Any project member can add, edit and delete items and set or clear the cups. Edits use per-field last-write-wins like extra costs; a non-member gets `404`, signed out `401`.
9. Changes made offline are queued and synced like other product data ("Chờ lưu").
10. The project screen's "Chi phí cố định" tile is enabled and shows the monthly total ("8.600.000 ₫ mỗi tháng", or "Chưa có" when empty).
11. The fixed costs screen matches mockup group 1: hero with total, cups and share (1b); cups row opening a sheet (1e); "Các khoản · n" section collapsed by default showing the total (1b), expanding to rows with kind and monthly amount (1c); add/edit form with kind switch and live monthly result (1d, 1d′); field errors (1f); delete confirm naming the new total and share (1g); empty (1h); items but no cups (1i); loading and error (1j); dark mode (1k).
12. The product list, product detail and price sheet match mockup group 2: list profit after the share with a one-line note (2a); a "Chi phí cố định mỗi ly" row in detail opening the fixed costs screen (2b); price sheet splitting cost of the product and the share (2c); no-cups state (2d).
13. Changing the currency is refused once any fixed cost item exists, like other money data (#13 B1).
14. All text exists in Vietnamese and English.

## Acceptance Criteria

1. API test: create, rename, change kind/amount/months, delete an item; empty or duplicate name, amount 0, N outside 1–120, N on a non-oneTime item refused with `400`.
2. API test: the 51st item is refused with `fixed_cost_limit_reached`.
3. Unit test: monthly amount per kind with rounding (600.000 weekly → 2.600.000; 18.000.000 over 24 → 750.000) and total.
4. API test: cups set, changed, cleared; 0 and 1.000.001 refused.
5. Unit test: share 8.600.000 ÷ 1.500 = 5.733; no share when cups unset or total 0; USD rounds to cents.
6. Unit test: full cost, profit, margin and hint use the share (Trà sữa M: 16.768, 18.232, 52%, hint 48.000); without a share they equal #13's results.
7. Unit test: two sizes of different products get the same share.
8. API test: per-field LWW on item fields and cups; same id twice idempotent; non-member `404`; signed out `401`.
9. Unit test: queued item and cups changes merge per field. By hand: offline "Chờ lưu" then sync.
10. By hand, mockup 1a.
11. By hand, mockups 1b–1k.
12. By hand, mockups 2a–2d.
13. API test: currency change refused with a fixed cost item present.
14. Unit test: every new i18n key exists in both languages.
15. Check: `prisma migrate deploy` succeeds on an empty database and on one with #13's data.

## Out of Scope

- Break-even calculator and cash flow (deferred by the Epic).
- Start or end dates; a one-time item keeps being spread until deleted (mockup assumption 2).
- Different shares per size or per product.
- The fixed share inside drafts (#15) — drafts show #13 costs.

## Open Questions

- Should a one-time item stop after its N months? Built as "never stops" for now (mockup assumption 2); changing it later needs a start date.
