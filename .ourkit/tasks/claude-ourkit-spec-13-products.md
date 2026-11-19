# Tasks: Members can build products and see the cost of each cup

Spec: `.ourkit/specs/claude-ourkit-spec-13-products.md`. Plan: `.ourkit/plans/claude-ourkit-spec-13-products.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-13-products.html` (group 2, plus 1a and 1g).

## Tasks

### 1. Products, extra costs and target margin: schema, migration and API

Add to `apps/api/prisma/schema.prisma` and a migration `apps/api/prisma/migrations/20261119130000_products/` (additive; after `20261119120000_ingredients`): enum size S/M/L, `Product`, `ProductSizeRow`, `RecipeLine` (ingredient FK Restrict), `SizeExtra`, `ExtraCost`, `Project.targetMargin Int default 65` + `targetMarginEditedAt`. Add `apps/api/src/products/routes.ts` and `extraCosts.ts` (mounted in `src/app.ts`), following `src/ingredients/routes.ts` for auth, locking, zod, LWW, idempotent create. Creating a size inserts ticked default ingredient lines (portion amount 1, others 0) and copies default extra costs. Lines and extras of a size are one replace-all LWW field; default lines can be unticked but not removed. Project PATCH accepts `targetMargin` (1–95, LWW). Ingredient DELETE returns `409 ingredient_in_use` with product names. Limits and codes per spec R1–R8, R11, R13. Tests in `src/products/*.test.ts` for AC 1–8, 11 (range), 13, 23.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass

### 2. Cost, profit and hint math on the phone

Add `apps/mobile/src/products/cost.ts` (line cost rounded to whole minor unit, size cost over ticked lines and extras, profit, margin whole percent, hint rounded up to 1.000 VND / 10 cents USD, latest price-update line) and `order.ts` (A–Z, which size summarises the row). Unit tests for AC 9, 10, 11, 12, 16.

Depends on: none
Verify: `ourkit gate run test` passes

### 3. Products sync, store and provider

Add `apps/mobile/src/products/{types,api,entities,sync,syncCycle,store,overlay}.ts` and `ProductsProvider.tsx` like `src/ingredients/`, wired inside `IngredientsProvider`; extra costs and target margin included. Queue order: ingredient changes flush before product changes. Unit test for merged queued changes (AC 14).

Depends on: 1
Verify: `ourkit gate run test` passes

### 4. Product screens, extra costs screen, tile and ingredient-in-use

Routes `projects/[id]/products/index.tsx` (2a, 2j), `new.tsx` (2g), `[productId].tsx` (2b, 2c, 2g′, 2i, sheets 2d, 2e, 2f, target margin), `extra-costs.tsx` (2h); Sản phẩm tile enabled with "n món" (1a); ingredient delete shows the blocking message with product names (1g). Reuse `ui/Segmented.tsx`, `ui/Collapsible.tsx`, `tasks/SheetFrame.tsx`. VI/EN strings. Match mockup frames, DESIGN.md tokens, light/dark, 44pt, accessibility, offline "Chờ lưu".

Depends on: 2, 3
Verify: `ourkit gate run test` and `ourkit gate run lint` pass; visual check is a Test Handoff (#47 section G)
