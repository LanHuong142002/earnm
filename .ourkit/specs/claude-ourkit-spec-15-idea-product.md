# Spec: #15 (revised) Drink drafts turn into products

Ticket: https://github.com/LanHuong142002/earnm/issues/15 · Mockup: `.ourkit/mockups/claude-ourkit-spec-15-idea-product.html`, bản 2, group A. It was approved on 2026-11-20.

The scope changed after the user reviewed mockup bản 1:
- Ideas are now about the project.
- Drink ideas move to a new area, **Nháp món** (drafts). A draft marked Done converts into a product, creating any missing ingredients.
- The rest of bản 2 goes to its own tickets: B is idea → draft, C is comment → idea or draft, D is the like/unlike icons. Comments, photos and likes on drafts are split into ticket E, so that this ticket fits one cycle (Decision 2).

## Goal

The group can work out a new drink together before it exists:
- a name, sizes, a recipe for one base size and an expected price;
- ingredients that aren't bought yet.

When the draft is Done, one tap turns it into a real product with its recipe, adding the new ingredients to the list. Nothing has to be typed twice.

## Requirements

1. A project has drafts. Each draft has:
   - a name (1–60 characters, as for products and ingredients);
   - sizes, a non-empty subset of S/M/L, where the base size is the smallest chosen;
   - an optional expected price for the base size;
   - an optional note (up to 2.000 characters);
   - a status, `working` or `done`; new drafts are `working`.
   A project holds at most 200 unconverted drafts.
2. A draft has recipe lines for one cup of the base size, at most 100. Each line is one of two kinds:
   - **Existing:** an existing ingredient and an amount above 0. It can't repeat an ingredient.
   - **New:** a new-ingredient name, a kind (weigh/measure/count, as in #12), an amount per cup above 0, and an optional purchase quantity and purchase price. The name is unique among the draft's new lines, and also unique against the project's existing ingredients at the time of adding.
3. Any member can create, edit and delete a draft, its lines and its status while it is unconverted. Edits use per-field last-write-wins, like products. A non-member gets `404`; a signed-out request gets `401`.
4. The draft shows an estimated cost:
   - each line's cost is worked out like #13;
   - the total adds the project's default ingredients and default extra costs, as the product will get them.
   - When any new line lacks a purchase quantity or price, there is no estimate; the screen names what is missing.
   - With an expected price, the screen shows the expected profit and margin.
5. Setting the status to `done` is refused, with a list of what is missing, unless the draft has:
   - a name;
   - at least one size;
   - at least one line;
   - a purchase quantity and price on every new line.
   `done` can go back to `working`. An edit that makes a done draft incomplete (for example deleting its last line or clearing a purchase price) returns it to `working`.
6. **Convert** is allowed only on a `done`, unconverted draft, and needs the network. It runs in one transaction:
   - each new line creates an ingredient with its purchase data, unless an ingredient with the same name now exists, in which case that one is used;
   - a product is created with the draft's name and sizes;
   - every size gets the default lines and extras, as in #13, plus the draft's lines with their amounts;
   - the expected price becomes the base size's selling price.
   The draft records the product and the conversion time, and becomes read-only.
7. Convert is refused with a clear reason, leaving the draft unchanged, when:
   - a product with the same name exists;
   - the product limit (200) or the ingredient limit (300) is reached;
   - the draft is not done or already converted;
   - a new line's name now matches an existing ingredient that is counted a different way (`draft_ingredient_mode_mismatch`);
   - lines for the same ingredient add up to more than one line can hold (`draft_line_amount_too_large`).
8. Before converting, the phone shows a confirm dialog listing the ingredients to add, the existing ingredients it will reuse, and the product with its sizes and price (A8).
9. A converted draft shows a link to its product; the product shows "Từ nháp …" linking back. If the product is deleted, the draft keeps its read-only content with "Món đã bị xoá" and no link. A converted draft can be deleted (draft and lines); the product stays and its "Từ nháp" link disappears.
10. Offline, edits to unconverted drafts are queued and synced ("Chờ lưu"); convert shows the network notice.
11. The screens match mockup bản 2 group A:
    - project tile, A1;
    - list with Done, Working and a collapsed Converted section, A2;
    - draft detail, A3;
    - add-line sheet with search and "new ingredient", A4;
    - new-ingredient line form, A5;
    - status sheet with the missing list, A6;
    - Done with the Convert button, A7;
    - confirm, A8;
    - read-only converted draft, A9;
    - product "Từ nháp" link, A10;
    - empty state and convert errors, A11;
    - dark mode, A12.
    The like row, comments and photos in A3 and A9 are not built here (ticket E).
12. Changing the project currency is refused once an unconverted draft has an expected price or new-line purchase price.
13. All text exists in Vietnamese and English.

## Acceptance Criteria

1. API test: create, edit and delete a draft; an empty name, no sizes, or the 201st draft is refused.
2. API test: add, edit and remove both line kinds. These are refused: a duplicate ingredient, amount 0, a new-line name already used by an ingredient, and line 101.
3. API test: per-field LWW; the same id twice is idempotent; a non-member gets `404`; a signed-out request gets `401`; editing a converted draft gets `409 draft_converted`.
4. Unit test: the estimate with defaults; no estimate and the missing names while a new line lacks a price; expected profit and margin. It uses the mockup numbers: 9.579 and 12.679.
5. API test: `done` is refused with `missing` reasons for each rule; `done` back to `working` works.
6. API test: convert creates the ingredients and the product with its sizes, lines, defaults and the base price, in one transaction, and reuses a same-name ingredient. A failure part-way leaves nothing created.
7. API test: each refusal reason in R7 returns its own code, and the draft is unchanged.
8. By hand, mockup A8.
9. API test: the draft↔product link; deleting the product clears the link and keeps the draft read-only. By hand, A9 and A10.
10. Unit test: queued draft changes merge per field. By hand: offline "Chờ lưu"; convert offline shows the notice.
11. By hand, mockups A1–A7 and A11–A12 (without the like, comments and photos parts).
12. API test: a currency change is refused with a priced draft.
13. Unit test: every new i18n key exists in both languages.
14. Check: `prisma migrate deploy` succeeds on an empty database and on one with #13's data.

## Out of Scope

- Comments, photos and like/unlike on drafts (ticket E).
- Idea → draft (B), comment → idea or draft (C), and the like/unlike icons on ideas (D).
- Per-size recipes in the draft. The base recipe is copied to every size; amounts are edited on the product afterwards.
- The fixed-cost share (#14) in draft estimates.
- Removing the existing "Tạo công việc" flow from ideas: it stays.

## Open Questions

- Is it right to move comments, photos and likes on drafts to ticket E (Decision 2)? If they must ship with this ticket, it grows past one cycle.
