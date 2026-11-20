# Plan: #15 (revised) Drink drafts

## Approach

Add a `Draft` area that sits beside products and reuses their pieces:
- The draft and its lines are stored as inputs only.
- The phone works out the estimate with the existing `products/cost.ts` and `defaults.ts`.
- A single `POST /projects/:id/drafts/:draftId/convert` endpoint does the conversion inside one Prisma transaction. It calls the same create helpers that the ingredient and product routes use, so limits, validation and defaults behave identically.
- Draft editing follows the product LWW and offline-queue pattern. Convert is online-only, like idea → task.

## Prior Art

- **Product create, sizes and defaults** (`apps/api/src/products/routes.ts`, mobile `products/defaults.ts`): **reuse**. Extract the create logic into a function that takes a transaction client, and call it from both the product route and convert.
- **Ingredient create with limit and name check** (`apps/api/src/ingredients/routes.ts`): **reuse** the same way, through an extracted transactional helper.
- **Idea → task** (`apps/api/src/ideas/…` `createIdeaToTaskRouter`, `Idea.taskId @unique` with SetNull): **reuse** the pattern for the one-time link and the online-only action. `Draft.productId` is `@unique` with `onDelete: SetNull`.
- **Product LWW, overlay, sync and the "Chờ lưu" queue** (mobile `products/overlay.ts`, `sync.ts`, `store.ts`): **reuse** for drafts.
- **Cost maths** (`products/cost.ts` `lineCost`, `sizeCost`, `profit`, `marginPct`): **reuse** for the estimate, with a small adapter for new lines that don't exist as ingredients yet.
- **The currency lock** (#13 B1): **extend** it to drafts.

No new library is needed.

## Changes

- **API schema:** a migration adding:
  - `Draft`: id, projectId, name, sizes, expectedPrice?, note, status enum, productId? unique SetNull, convertedAt?, the `…EditedAt` fields, createdAt;
  - `DraftLine`: id, draftId, kind `existing|new`, ingredientId?, newName?, newKind?, purchaseQty?, purchasePrice?, amount, the `…EditedAt` fields.
  (R1, R2, R9)
- **API routes:** `apps/api/src/drafts/routes.ts` for CRUD, lines and status with the `missing` check (R3, R5), plus `drafts/convert.ts` (R6, R7). Mounted in `app.ts`. The transactional create helpers are extracted from the ingredient and product routes without changing their behaviour.
- **API sync and currency:** drafts are included in the project sync response (R10), and the currency lock covers them (R12).
- **Mobile logic:** `drafts/` for entities, store, overlay, sync and provider (R10), plus `drafts/estimate.ts`, a pure module for the estimate and the missing list (R4, R5).
- **Mobile screens**, under `projects/[id]/drafts/`:
  - `index.tsx`: A2 and A11 empty;
  - `new.tsx`;
  - `[draftId].tsx`: A3, A7, A9 and A12;
  - an add-line sheet: A4;
  - `[draftId]/line.tsx`: A5;
  - a status sheet: A6;
  - a confirm dialog: A8;
  - error notices: A11.
  The project tile is A1. On the product detail, a "Từ nháp" row is A10. (R8, R9, R11)
- **i18n:** new keys in `vi.json` and `en.json`. (R13)

## Risks

- **Sensitive Areas:** data, schema, money and the public API. Convert writes many rows at once. Mitigations:
  - a single transaction;
  - a test that forces a failure part-way and checks nothing is created;
  - a guard against a double tap: the transaction checks `productId IS NULL` and the second call gets `409`.
- **Extracting the create helpers could change product or ingredient behaviour.** The existing route tests (708 API) must stay green.
- **Name race:** someone adds an ingredient with the same name between Done and Convert. The convert transaction reuses it (Decision 3), and the confirm dialog shows that.
- **Scope:** comments, photos and likes on drafts are left for ticket E (Question 1). If the user wants them in this ticket, the plan grows by the comment, photo and vote tables and their screens.

## Test Strategy

- **API (Vitest via `ourkit gate run test`):** AC 1, 2, 3, 5, 6, 7, 9 (the API part) and 12, following the product and idea-to-task route tests.
- **Mobile unit tests:** AC 4, 10 (the merge part) and 13.
- **Typecheck and lint:** through `ourkit gate run`.
- **Test Handoff (real iPhone, added as section I of ticket #47):** AC 8, 9, 10 (offline) and 11. AC 14, migrate on the dev database, is also handed off.
