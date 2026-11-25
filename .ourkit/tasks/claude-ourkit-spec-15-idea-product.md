# Tasks: #15 (revised) Drink drafts

Spec: `.ourkit/specs/claude-ourkit-spec-15-idea-product.md` · Plan: `.ourkit/plans/claude-ourkit-spec-15-idea-product.md` · Mockup: `.ourkit/mockups/claude-ourkit-spec-15-idea-product.html`, group A. Ignore the like, comments and photos parts, which belong to #53.

## Tasks

### 1. API: Draft and DraftLine schema, CRUD, lines and status

In `apps/api`:

- **Migration.** Add a Prisma migration for:
  - `Draft`: id, projectId with Cascade, name, sizes (an array or JSON of S/M/L), expectedPrice Int?, note, status enum `DraftStatus { working done }`, productId String? @unique with SetNull to Product, convertedAt?, the per-field `…EditedAt` fields, createdAt.
  - `DraftLine`: id, draftId with Cascade, kind enum `existing | new`, ingredientId? with SetNull, newName?, newKind? (the ingredient kind enum from #12), purchaseQty?, purchasePrice?, amount, `…EditedAt` fields, createdAt.
- **Routes.** Add `src/drafts/routes.ts`, mounted in `app.ts` at `/projects/:projectId/drafts`, for list, create, patch and delete of a draft and its lines, and for setting the status. Follow `src/products/routes.ts` for validation, per-field LWW, idempotent create by id, `404` for a non-member, `401` when signed out, and project locking. It must:
  - enforce spec R1 to R3 and R5, including the 200 unconverted-draft limit, 100 lines, the duplicate-ingredient check, a new-line name clashing with an existing ingredient, and amount > 0;
  - refuse `done` with `409 draft_incomplete` and a `missing` list;
  - refuse any edit of a converted draft with `409 draft_converted`.
- **Currency lock.** Extend it in `src/projects/routes.ts` to count drafts with an expectedPrice or a new-line purchasePrice (R12).
- **Tests first.** They cover AC 1, 2, 3, 5 and 12.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass

### 2. API: convert a draft into a product

- **Extract the helpers.** Pull the transactional create logic out of `src/ingredients/routes.ts` (ingredient create with its limit of 300, name check and price fields) and `src/products/routes.ts` (product create with sizes, the default lines and extras, and the selling price). Make them functions that take a Prisma transaction client, and keep both existing routes behaving exactly as now, with their existing tests green.
- **Convert route.** Add `src/drafts/convert.ts`: `POST /projects/:projectId/drafts/:draftId/convert`. Inside one transaction, under the project lock, with a `productId IS NULL` guard, it:
  1. checks the draft is done and not yet converted;
  2. for each new line, reuses an ingredient with the same name (by name key) or creates one;
  3. creates the product with the draft's name and sizes;
  4. gives every size the defaults plus the draft lines with their amounts;
  5. sets the base size's selling price to expectedPrice;
  6. sets the draft's productId and convertedAt.
- **Refusals.** These return distinct codes and leave nothing changed (R7): `draft_not_done`, `draft_converted`, a duplicate product name, `product_limit_reached` and `ingredient_limit_reached`.
- **Response.** Return the product id, plus which ingredients were created and which were reused.
- **Product deleted.** The draft's productId becomes null through SetNull, and the draft stays read-only because convertedAt stays set (R9).
- **Tests first.** They cover AC 6, 7 and 9 (the API part), including a forced failure part-way that must leave no rows behind.

Depends on: 1
Verify: `ourkit gate run test` and `ourkit gate run build` pass

### 3. Mobile: draft estimate and missing list

Add `apps/mobile/src/drafts/estimate.ts`, a pure module, with tests. It:
- works out each line's cost with `products/cost.ts` `lineCost`, building a cost ingredient from the new line's purchaseQty and purchasePrice;
- returns null when any new line lacks a price, together with the names that lack one;
- adds the project's default ingredients and default extra costs as `products/defaults.ts` does;
- works out expected profit and margin;
- returns the missing list for Done (R5).

The tests use the mockup numbers: a recipe of 9.579 and 12.679 with defaults. They cover AC 4.

Depends on: none
Verify: `ourkit gate run test` passes

### 4. Mobile: drafts data, sync and offline queue

Add `apps/mobile/src/drafts/` with types, api, store, overlay, sync and a provider (or extend `ProductsProvider`), mirroring how products and extra costs are handled. It covers:
- queued create, edit and delete of drafts and lines, the status change, and "Chờ lưu";
- a convert action that needs the network, calls the convert route, and refreshes products, ingredients and drafts.

Unit tests check that queued changes merge per field (AC 10).

Depends on: 1, 2, 3
Verify: `ourkit gate run test` and `ourkit gate run lint` pass

### 5. Mobile: drafts screens

Build to the mockup, group A:
- **Project tile "Nháp món"** with the count of unconverted drafts (A1).
- **List** `projects/[id]/drafts/index.tsx`: the Xong section, then Đang làm, then a collapsed "Đã chuyển" (A2); the empty state (A11).
- **New draft** `new.tsx`: name, size pills, note; the base size is the smallest chosen.
- **Detail** `[draftId].tsx`:
  - a status row with the down arrow centred and no tick, opening a status sheet with the missing list (A3, A6);
  - the base recipe lines, marking new lines "Mới" and a missing price "Thiếu giá";
  - the estimate, or a hint naming what is missing;
  - the hero for a Done draft and the primary "Chuyển thành món" button (A7);
  - the confirm dialog listing the ingredients to create and to reuse, the sizes and the price (A8);
  - the read-only converted view with a link to the product, or "Món đã bị xoá" (A9);
  - convert errors as notices (A11);
  - dark mode (A12).
- **Add-line sheet** with search over existing ingredients and a "là nguyên liệu mới" row (A4).
- **New-ingredient line form** (A5).
- **Product detail** (`products/[productId].tsx`): a "Từ nháp …" row linking to the draft (A10). The API product response must include the draft id, or the phone gets it from the drafts store.

All new text goes in vi and en, and the parity test covers it (AC 13). Don't build the like, comments or photos (#53).

Depends on: 4
Verify: `ourkit gate run test` and `ourkit gate run lint` pass; screens by hand vs mockup (Test Handoff, #47 section I)
