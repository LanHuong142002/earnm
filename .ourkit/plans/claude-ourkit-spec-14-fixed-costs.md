# Plan: #14 Fixed costs

## Approach

Follow the extra costs pattern from #13 end to end. The API stores only inputs: a new `FixedCost` table and `expectedCupsPerMonth` on `Project`, both with per-field `…EditedAt` for last-write-wins. The phone computes the monthly amounts, the total, the per-cup share and the full cost in pure functions next to `products/cost.ts`, so a change to an item or the cups updates every product without any backfill (the same reason as #13 Decision 1). The screens follow the approved mockup.

## Prior Art

- `apps/api/src/products/extraCosts.ts`: a project-scoped list with GET/POST/PATCH/DELETE, a limit, LWW and idempotent create. **Reuse** its shape for `fixedCosts.ts`.
- `Project.targetMargin` and `targetMarginEditedAt` in `projects/routes.ts`: a project-level number with LWW. **Reuse** it for `expectedCupsPerMonth`.
- Mobile `products/overlay.ts` (`applyExtraCostOverlay`), `sync.ts`, `store.ts`, `ProductsProvider.tsx`, and the `products/extra-costs.tsx` screen. **Reuse** them for queued changes and the list screen.
- `products/cost.ts` (`sizeCost`, `profit`, `marginPct`, `hintPrice`). **Extend** it with `monthlyAmount`, `fixedTotal`, `perCupShare` and `fullCost`; `profit`, `margin` and `hint` get the full cost as their input.
- The currency-lock check in `projects/routes.ts` (#13 B1). **Extend** it to count fixed costs.

No library is needed.

## Changes

- **API schema:** a Prisma migration adding `FixedCost` (id, projectId, name, kind enum `monthly|weekly|oneTime`, amount Int, months Int?, the `…EditedAt` fields, createdAt), plus `Project.expectedCupsPerMonth Int?` and `expectedCupsEditedAt`. (R1, R4)
- **API routes:** `apps/api/src/products/fixedCosts.ts`, mounted at `/projects/:projectId/fixed-costs`, with validation, the 50-item limit, unique names and LWW. (R1, R2, R8)
- **API cups:** `projects/routes.ts` PATCH accepts `expectedCupsPerMonth` (1–1.000.000 or null) with LWW, and the currency lock counts fixed costs. (R4, R8, R13)
- **API sync:** the project and sync responses include fixed costs and the cups. (R9)
- **Mobile maths:** add `products/fixedCost.ts`, a pure module with its own tests. (R3, R5–R7)
- **Mobile data:** add fixed costs to the entities, store, overlay, sync and the provider, with the queue and "Chờ lưu". (R9)
- **Mobile screens:**
  - `projects/[id]/fixed-costs/index.tsx`: mockup 1b, 1c, 1h, 1i, 1j, 1k.
  - `fixed-costs/[fixedCostId].tsx` and `new.tsx`: the form, 1d, 1d′, 1f, 1g.
  - A cups sheet: 1e.
  - The project tile is enabled: 1a.
  (R10, R11)
- **Product screens:**
  - The list note and profit after the share: 2a.
  - The "Chi phí cố định mỗi ly" row in `RecipeSections`: 2b and 2d.
  - The price sheet split: 2c.
  - The hero labels "Giá vốn đủ" and "chưa tính chi phí cố định".
  (R6, R12)
- **i18n:** new keys in `vi.json` and `en.json`. (R14)

## Risks

- **Sensitive Areas** are data, schema, money and the public API, so a wrong rounding rule shows wrong money everywhere. Mitigation: unit tests use the mockup's exact numbers, and USD is tested in cents.
- **Migration on the live database.** It is additive only: a new table and a nullable column, so it is safe on existing data. AC 15 checks it.
- **Many products recompute** whenever an item changes. That is pure maths over at most 200 products, so cheap.
- **A drop in shown profit** surprises users: every product turns "dưới 65%". This is intended; the one-line note in 2a explains it.

## Test Strategy

- **API (Vitest via `ourkit gate run test`):** AC 1, 2, 4, 8, 13. Route tests follow `extraCosts.test.ts`.
- **Mobile unit tests:** AC 3, 5, 6, 7, 9 (the merge part), 14.
- **Typecheck and lint:** run through `ourkit gate run`, as the commands are declared in the Stack Profile.
- **Not verifiable here, so it goes to the Test Handoff:**
  - AC 9 offline on a phone, and AC 10–12 screens against the mockup on a real iPhone. These are added as section H of ticket #47.
  - AC 15 migrate on the dev database with #13 data.
