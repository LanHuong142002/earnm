# Plan: Members can build products and see the cost of each cup

Spec: `.ourkit/specs/claude-ourkit-spec-13-products.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-13-products.html` (group 2, frames 2a–2k, and 1a, 1g). Builds on #12's branch.

## Approach

Store only inputs (amounts, selling prices, target margin) and compute every cost on the phone from current ingredient prices, so a price change never needs a backfill. Models: `Product` → `ProductSize` → `RecipeLine` (to `Ingredient`, `onDelete: Restrict`) and `SizeExtra` (a copied name+amount), plus project-level `ExtraCost` and `Project.targetMargin`. For sync, each size's recipe and extras travel together as one last-write-wins "lines" field (replace-all), so lines that depend on an ingredient's create never ride inside another change's payload (lesson). Pure modules do the math: `products/cost.ts`.

## Prior Art

- #12's `ingredients/cost.ts` (unit cost), `formatMoney` / `formatUnitCost`, `ui/Segmented.tsx`, ingredients provider: reuse.
- Ideas/ingredients router, LWW helper and sync entity pattern: copy.
- `tasks/SheetFrame.tsx` with RN `Modal` pageSheet for the four sheets; `ui/Collapsible.tsx` for sections; `Alert.alert` for confirms.
- Conclusion: reuse; only new code is the product domain and screens.

## Changes

**API (`apps/api`)**
- `schema.prisma` + migration `2026111913xxxx_products` (after #12's, rechecked before Ship): enum `ProductSize {S M L}`; `Product` (id, projectId cascade, name, nameKey unique per project, `nameEditedAt`, `sizesEditedAt`); `ProductSizeRow` (id, productId cascade, size, sellingPrice Int?, `priceEditedAt`, `linesEditedAt`, unique productId+size); `RecipeLine` (sizeId cascade, ingredientId Restrict, amount Decimal(12,3), included, isDefault); `SizeExtra` (sizeId cascade, name, amount Int, included, isDefault); `ExtraCost` (projectId cascade, name, amount, isDefault, per-field editedAt); `Project.targetMargin Int default 65` + `targetMarginEditedAt` (additive, default kept).
- `src/products/routes.ts` (list with sizes and lines, create with default lines, PATCH name / sizes / `sizes/:size` price / `sizes/:size/lines`, delete), `src/products/extraCosts.ts`, project PATCH accepts `targetMargin`.
- `src/ingredients/routes.ts` DELETE: catch FK, return `409 ingredient_in_use` with product names.

**Mobile (`apps/mobile`)**
- `src/products/`: types, `cost.ts` (line, size, profit, margin, hint), api, entities, sync, syncCycle, store, order, `ProductsProvider.tsx`, `SizeHero`, `RecipeSection`, `ExtrasSection`, sheets `LineAmountSheet`, `IngredientPicker`, `PriceSheet`, `TargetMarginSheet`.
- Routes `projects/[id]/products/index.tsx` (2a, 2j), `new.tsx` (2g), `[productId].tsx` (2b, 2c, 2g′, 2i, sheets), `extra-costs.tsx` (2h).
- Project tile enabled (1a). Ingredient delete shows product names (1g).
- `i18n` VI/EN.

## Risks

- **Sensitive (data, schema, money, api):** additive migration only; `Restrict` FK guarantees R8 even if the phone is stale.
- Replace-all lines field: a stale edit could drop a newer line; LWW on `linesEditedAt` refuses the older one (test).
- Offline line pointing at an ingredient still in the queue: the queue flushes ingredients before products (entity order) and the API refuses unknown ingredients, shown as rejected.
- Rounding differences between line sums and display: one module, unit-tested.
- Migration order with #12 and other branches: recheck before Ship.

## Test Strategy

Commands: `ourkit command test`, `lint`, `build`.
- API vitest `src/products/*.test.ts`: AC 1–8, 11 (target range), 13; migration check AC 23.
- Mobile vitest: `products/cost.test.ts` (AC 9–12), `order.test.ts` (AC 16), `sync.test.ts` (AC 14), i18n parity.
- By hand on a real iPhone (Test Handoff, added to #47): AC 8 screen, 14 offline, 15, 17–22. Reviewers run one after another; after round one only fix commits are re-reviewed.
