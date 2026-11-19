# Plan: Members can record ingredients and their unit cost

Spec: `.ourkit/specs/claude-ourkit-spec-12-ingredients.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-12-ingredients.html` (group 1, frames 1a–1i).

## Approach

Copy the ideas (#11) shape with fewer moving parts: one `Ingredient` model with per-field last-write-wins and an `IngredientPrice` history table, one Express router, and one mobile feature folder with a registered sync entity, provider and three screens. All money is an integer in the currency's minor unit and all quantities are stored in base units, so the unit-cost math is one pure module shared in spirit by API tests and phone (the phone computes and formats; the API only stores). The purchase (quantity, unit, price) is a single last-write-wins field, so a history entry is written exactly when that field wins.

## Prior Art

- `apps/api/src/ideas/routes.ts`, `common.ts`, `http/last-write-wins.ts`, `projects/access.ts` (`findForMember`, `lockProject`, `lockedMember`): reuse as is.
- `apps/mobile/src/ideas/{entities,sync,syncCycle,IdeasProvider}.ts(x)` and `sync/queue.ts` `registerEntity`: copy the pattern.
- `apps/mobile/src/lib/currency.ts` `formatMoney`: reuse for whole amounts; add a `formatUnitCost` beside it for the 2-decimal per-unit value (no existing helper; hand-rolled like `formatMoney`, no `Intl`).
- `ui/Collapsible.tsx` (history section), `ui/Card`, `TextField`, `Button`, `AreaTile`, RN `Switch` (as in `tasks/FilterBar.tsx`), `Alert.alert` for delete confirm.
- No segmented control exists: write a small `ui/Segmented.tsx` (needed again by #13 for S/M/L). Conclusion: reuse everything else, write only `Segmented` and the cost module new.

## Changes

**API (`apps/api`)**
- `prisma/schema.prisma` + migration `2026111912xxxx_ingredients` (timestamp after `20261118130000_ideas`, rechecked against `main` before Ship): enum `IngredientMode {weight volume portion}`; `Ingredient` (id, projectId cascade, name, nameKey lowercased unique with projectId, mode, quantity `Decimal(12,3)` base units, unit text `kg|g|l|ml|portion`, price Int, isDefault Boolean, `nameEditedAt`, `modeEditedAt`, `purchaseEditedAt`, `defaultEditedAt`, createdAt); `IngredientPrice` (id, ingredientId cascade, quantity, unit, price, authorId SetNull, recordedAt; index ingredientId+recordedAt).
- `src/ingredients/routes.ts`: `GET /projects/:id/ingredients` (with latest 5 prices and author names), `POST` (create + first price, limit 300, `ingredient_limit_reached`, duplicate name `ingredient_name_taken`), `PATCH /:ingredientId` (per-field LWW; when `purchase` wins, insert a price row and delete beyond 5 in the same transaction), `DELETE /:ingredientId`. zod schemas with mode/unit consistency, quantity > 0 ≤ 1.000.000, price 0 … 1e9 VND / 1e7 cents USD by project currency.
- `src/app.ts` mount.

**Mobile (`apps/mobile`)**
- `src/ingredients/`: `types.ts`, `cost.ts` (toBase, unitCost, per1/per10, total), `api.ts`, `entities.ts`, `sync.ts`, `syncCycle.ts`, `store.ts`, `order.ts` (Vietnamese A–Z via `localeCompare('vi')`), `validate.ts`, `IngredientsProvider.tsx` (wired next to `IdeasProvider`), `IngredientRow.tsx`, `IngredientForm.tsx`, `PriceHistory.tsx`.
- `src/lib/currency.ts`: `formatUnitCost`.
- `src/ui/Segmented.tsx`.
- Routes `projects/[id]/ingredients/index.tsx` (1b, 1h, 1i), `new.tsx` (1c, 1d, 1e), `[ingredientId].tsx` (1f, delete confirm).
- `projects/[id]/index.tsx`: new Nguyên liệu tile with count (1a); Sản phẩm stays coming soon.
- `i18n/vi.json`, `en.json`.

## Risks

- **Sensitive (data, schema, money, api):** new tables and money values. Integers only; a test covers rounding at both currencies. Migration is additive (no drops, no NOT NULL without default on existing tables).
- History must not double-write on retries: same id twice is idempotent, and a stale purchase edit loses LWW and writes nothing (test).
- Migration order with other open branches (lesson): recheck timestamps before Ship.
- Decimal quantity arrives in Prisma as `Decimal`; serialize as a string-free number with 3 decimals in the response helper to avoid float drift.
- Project delete cascades both tables; no external files involved.

## Test Strategy

Commands: `ourkit command test` (`npm --prefix apps/api test && npm --prefix apps/mobile test`), `lint`, `build`.
- API vitest (`src/ingredients/routes.test.ts`): AC 1, 3, 5, 6, 7, 8, 9; migration deploy on empty and seeded DB via the existing migration test pattern (AC 19).
- Mobile vitest: `cost.test.ts` (AC 2, 4, 10), `currency.test.ts` additions (AC 3, 4), `order.test.ts` (AC 12), `validate.test.ts` (AC 14), `sync.test.ts` (AC 17), i18n parity.
- By hand on a real iPhone (Test Handoff, added to #47): AC 11, 12, 13, 14, 15, 16, 17 offline, 18. Reviewers run one after another (shared test DB lesson); after the first review round only fix commits are re-reviewed.
