# Tasks: #14 Fixed costs

Spec: `.ourkit/specs/claude-ourkit-spec-14-fixed-costs.md` · Plan: `.ourkit/plans/claude-ourkit-spec-14-fixed-costs.md` · Mockup: `.ourkit/mockups/claude-ourkit-spec-14-fixed-costs.html`

## Tasks

### 1. API: FixedCost table, cups on Project, routes

Do these in `apps/api`:

- **Migration.** Add a Prisma migration for:
  - `FixedCost`: id String @id, projectId (Cascade), name, kind enum `FixedCostKind { monthly weekly oneTime }`, amount Int, months Int?, nameEditedAt, kindEditedAt, amountEditedAt, monthsEditedAt, createdAt.
  - On `Project`: `expectedCupsPerMonth Int?` and `expectedCupsEditedAt DateTime @default(now())`.
- **Routes.** Add `src/products/fixedCosts.ts`, modelled on `src/products/extraCosts.ts`, with GET/POST/PATCH/DELETE at `/projects/:projectId/fixed-costs`. They need:
  - validation per spec R1: name 1–80, unique case-insensitive; amount 1..MAX_PRICE[currency]; months 1–120 only for `oneTime`, and null otherwise;
  - the 50-item limit, refused with `fixed_cost_limit_reached` (R2);
  - per-field last-write-wins with editedAt timestamps, and idempotent create by id (R8);
  - `404` for a non-member and `401` when signed out.
- **Cups.** In `src/projects/routes.ts`, accept `expectedCupsPerMonth` (an integer 1–1.000.000, or null) on the project PATCH with LWW, as for `targetMargin`. Return it in the project responses.
- **Currency lock.** Extend it so that any FixedCost blocks a currency change (R13).
- **Sync.** Include fixed costs wherever extra costs are returned to the phone, such as the sync and project payloads (R9).
- **Tests.** Write route tests first, following `extraCosts.test.ts`. They cover spec AC 1, 2, 4, 8 and 13.

Depends on: none
Verify: `ourkit gate run test` passes; `ourkit gate run build` passes

### 2. Mobile: fixed cost maths

Add `apps/mobile/src/products/fixedCost.ts`, a pure module, with `fixedCost.test.ts`. It needs these functions:
- `monthlyAmount(item, currency)`: `monthly` → amount; `weekly` → amount × 52 / 12; `oneTime` → amount / months; rounded half up to an integer of the smallest unit.
- `fixedTotal(items)`: the sum of the rounded monthly amounts.
- `perCupShare(total, cups)`: null when cups is null or total is 0; otherwise round(total / cups).
- `fullCost(sizeCost, share)`: sizeCost + (share ?? 0).

Profit, margin and hint keep using `products/cost.ts`, fed with the full cost.

The tests use the spec numbers:
- 600.000 weekly → 2.600.000;
- 18.000.000 over 24 → 750.000;
- 8.600.000 / 1.500 → 5.733;
- for Trà sữa M, a cost of 11.035 + 5.733 = 16.768 gives profit 18.232, margin 52% and hint 48.000 at a 65% target;
- USD rounding works in cents.
They cover spec AC 3, 5, 6 and 7.

Depends on: none
Verify: `ourkit gate run test` passes

### 3. Mobile: fixed cost data, sync and offline queue

In `apps/mobile/src/products/`, add the FixedCost entity and the project's `expectedCupsPerMonth` to the types, `api.ts`, `store.ts`, `overlay.ts` (an `applyFixedCostOverlay` like `applyExtraCostOverlay`), `sync.ts` and `ProductsProvider.tsx`. This gives queued create, edit and delete, a cups edit, and "Chờ lưu" (R8, R9).

Expose from the provider: the fixed costs, the cups, the total, the share, and the actions `addFixedCost`, `editFixedCost`, `deleteFixedCost` and `setExpectedCups`.

Add unit tests that queued changes merge per field (spec AC 9).

Depends on: 1, 2
Verify: `ourkit gate run test` passes; `ourkit gate run lint` passes

### 4. Mobile: fixed costs screens and project tile

Build the screens to match the mockup `.ourkit/mockups/claude-ourkit-spec-14-fixed-costs.html`, group 1:

- **Fixed costs screen:** `app/(app)/(home)/projects/[id]/fixed-costs/index.tsx`. It has the hero, the cups row, and the "Các khoản · n" section, collapsed by default and expandable (1b, 1c), plus the empty (1h), no-cups (1i), loading and error (1j) and dark (1k) states.
- **Cups sheet:** 1e.
- **Form:** `new.tsx` and `[fixedCostId].tsx`, with a kind segmented control, a months field only for one-time items, a live monthly result and the "after saving" hint (1d, 1d′). Field errors (1f), delete with a confirm that names the new total and share (1g).
- **Project tile:** enable "Chi phí cố định" on the project screen with the monthly total, or "Chưa có" when empty (1a).
- **Wiring:** register the routes in the `(home)/_layout.tsx` stack.
- **Text:** all new text goes into `src/i18n/vi.json` and `en.json` (R14).

Use `DESIGN.md` tokens and the existing components used by `products/extra-costs.tsx` and the ingredients screens. Add a unit test that every new i18n key exists in both languages (AC 14).

Depends on: 3
Verify: `ourkit gate run test` and `ourkit gate run lint` pass; screens by hand vs mockup (Test Handoff, #47 section H)

### 5. Mobile: products use the full cost

Do these in the product screens:
- **List:** in `products/index.tsx` and `ProductRow.tsx`, profit and margin use the full cost, with a one-line note "Lãi đã trừ X chi phí cố định mỗi ly" when a share exists (2a).
- **Detail:** in `[productId].tsx` and `RecipeSections.tsx`, the hero uses the full cost, labelled "Giá vốn đủ", with "đã tính chi phí cố định" as the subline. Add a "Chi phí cố định mỗi ly" row that opens the fixed costs screen, plus the explanatory hint (2b).
- **No cups:** without a share, the hero keeps the #13 numbers with "chưa tính chi phí cố định", and the row shows "Chưa tính" (2d).
- **Price sheet:** in `PriceSheets.tsx`, split the cost into "Giá vốn của món" and "Chi phí cố định mỗi ly"; profit and the hint use the full cost (2c).

Depends on: 3
Verify: `ourkit gate run test` and `ourkit gate run lint` pass; screens by hand vs mockup 2a–2d (Test Handoff)
