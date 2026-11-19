# Tasks: Members can record ingredients and their unit cost

Spec: `.ourkit/specs/claude-ourkit-spec-12-ingredients.md`. Plan: `.ourkit/plans/claude-ourkit-spec-12-ingredients.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-12-ingredients.html` (group 1).

## Tasks

### 1. Ingredient schema, migration and API

Add `IngredientMode` enum, `Ingredient` and `IngredientPrice` models to `apps/api/prisma/schema.prisma` and a migration `apps/api/prisma/migrations/20261119120000_ingredients/` (additive only). Add `apps/api/src/ingredients/routes.ts` (GET list with latest 5 prices + author names, POST, PATCH per-field LWW with `purchase` as one field writing a history row only when it wins and trimming to 5, DELETE) mounted in `apps/api/src/app.ts`, following `apps/api/src/ideas/routes.ts` (requireAuth, findForMember, lockProject/lockedMember, zod, applyLastWriteWins, phone-chosen ids, idempotent create). Limits and codes per spec R1–R9 (`ingredient_limit_reached`, `ingredient_name_taken`). Money is an integer in minor units with max by project currency; quantity Decimal(12,3) base units, returned as a number. Write `apps/api/src/ingredients/routes.test.ts` covering spec AC 1, 3, 5, 6, 7, 8, 9, and a migration check like the existing ones (AC 19).

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass

### 2. Cost math and money formatting on the phone

Add `apps/mobile/src/ingredients/cost.ts` (toBase from kg/g/l/ml/portion with up to 3 decimals, unit cost, per-1 with ≤2 decimals and per-10 whole, total of current prices), `formatUnitCost` in `apps/mobile/src/lib/currency.ts`, `order.ts` (Vietnamese A–Z) and `validate.ts` (form errors per spec R14 with VI/EN keys). Unit tests for AC 2, 3, 4, 10, 12, 14.

Depends on: none
Verify: `ourkit gate run test` passes

### 3. Ingredient sync, store and provider

Add `apps/mobile/src/ingredients/{types,api,entities,sync,syncCycle,store}.ts` and `IngredientsProvider.tsx` following `apps/mobile/src/ideas/` (registerEntity, per-field fieldTimes, purchase as one field), wired beside `IdeasProvider`. Unit test for merged queued changes (AC 17).

Depends on: 1
Verify: `ourkit gate run test` passes

### 4. Ingredient screens and project tile

Add `apps/mobile/src/ui/Segmented.tsx`; components `IngredientRow`, `IngredientForm`, `PriceHistory`; routes `apps/mobile/src/app/(app)/(home)/projects/[id]/ingredients/index.tsx`, `new.tsx`, `[ingredientId].tsx`; a Nguyên liệu `AreaTile` with count on `projects/[id]/index.tsx` (Sản phẩm stays coming soon); VI/EN strings in `apps/mobile/src/i18n/`. Match mockup frames 1a–1i, DESIGN.md tokens, light/dark, 44pt targets, accessibility labels, offline "Chờ lưu", navigation per spec.

Depends on: 2, 3
Verify: `ourkit gate run test` and `ourkit gate run lint` pass; visual check is a Test Handoff (#47 section F)
