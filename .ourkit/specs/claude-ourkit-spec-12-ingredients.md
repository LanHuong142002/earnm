# Spec: Members can record ingredients and their unit cost

Ticket: #12 (Epic F11). Tier: Feature. Sensitive Areas: data, schema, money, api. Mockup: `.ourkit/mockups/claude-ourkit-spec-12-ingredients.html` (bản 1, group 1 "Nguyên liệu", frames 1a–1i; approved by the user on 2026-11-19 together with its 10 assumptions). Mode: Hands-off.

## Goal

Each project gets an ingredients list. A member types once what was bought and what it cost (for example 1 kg of black tea for 180.000 ₫), and the app shows what 1 and 10 grams, millilitres or portions cost, plus the total spent at the top. #13 then uses these unit costs to work out the cost of each cup (Decisions 8, 10, 12).

Today a project has a `currency` (VND or USD, `apps/api/prisma/schema.prisma`) and the phone formats money with `apps/mobile/src/lib/currency.ts`. There are no money columns yet. Ingredients follow the ideas conventions (#11): project-scoped Prisma models, an Express router with `requireAuth` and `findForMember`, zod validation, phone-chosen ids, per-field last-write-wins, and the mobile sync queue with a registered entity.

## Requirements

### Ingredients

1. A project member can create an ingredient with: name 1–60 characters (trimmed, unique in the project ignoring case), a **mode** of weight (g), volume (ml) or portion, a purchase **quantity** greater than 0, a purchase **price** of 0 or more, and a **default** flag (off by default).
2. Quantity is entered in kg or g for weight, l or ml for volume, and as a count of portions for portion mode. It is stored in the base unit (g, ml, portion) with up to 3 decimals entered (so 1,5 kg = 1500 g); the unit last chosen is remembered for display. There is no conversion between modes.
3. Price is stored as a whole number of the currency's smallest unit (VND đồng; USD cents). Maximum 1.000.000.000 ₫ or 100.000 $; quantity at most 1.000.000 base units.
4. Unit cost = price ÷ base quantity. The phone shows cost per 1 unit with up to 2 decimals (63,16 ₫/g) and per 10 units rounded to the whole smallest unit (632 ₫/10 g), in the project's currency.
5. Any project member can edit name, mode, quantity, price and default, and delete an ingredient after confirming ("Xoá <tên>? Không hoàn tác được."). Blocking delete while a product uses it belongs to #13.
6. A project holds at most 300 ingredients; one more is refused with `ingredient_limit_reached`.

### Price history

7. Creating an ingredient records its first price entry (quantity, unit, price, who, when). Saving a different quantity or price adds a new entry; changing only the name, mode label or default does not.
8. Only the latest 5 entries per ingredient are kept; older ones are deleted when a 6th is added. The newest entry is the ingredient's current price.
9. Edits resolve last-write-wins per field (name, mode, purchase, default; quantity+unit+price travel together as "purchase"); the same id twice is idempotent; a stale purchase edit does not add a history entry; non-members get `404`, signed out `401`.

### Total

10. The top of the list shows "Tổng tiền mua nguyên liệu": the sum of the current price of every ingredient (latest purchase only), with the count of ingredients.

### On the phone

11. The project screen shows a new **Nguyên liệu** tile with "n loại", opening the list (mockup 1a). The **Sản phẩm** tile stays "Sắp có" until #13.
12. List (1b): hero card with the total; rows sorted A–Z (Vietnamese collation) with a mode icon, name, "Mặc định" chip when default, last purchase ("1 kg · 180.000 ₫"), and on the right the cost per 1 and per 10 units. "＋ Thêm" in the header.
13. New ingredient form (1c, 1d): name, mode segmented control (Cân (g) / Đo (ml) / Đếm (phần)), quantity with kg/g or l/ml switch (portion mode: "Số phần trong gói"), price, a live result card (per 1 and per 10), the "Mặc định" switch with its explanation, and "Lưu".
14. Validation (1e): after tapping Lưu, errors show under each field ("Nhập số lớn hơn 0", "Nhập giá đã mua", name empty or duplicate); the result card hides while it can't be computed.
15. Edit screen (1f): the same fields plus a collapsed "Lịch sử giá (n)" section (each entry: price, quantity, date, author, cost per unit, the current one marked "đang dùng") and "Xoá nguyên liệu".
16. Empty (1h), loading skeleton and load error with "Thử lại" (1i).
17. Offline: "Đang ngoại tuyến"; creating, editing and deleting queue like ideas and show "Chờ lưu"; refused changes show the existing rejected notice.
18. Light and dark mode with `DESIGN.md` tokens, VI and EN, 44pt targets, accessible names (rows read name, last purchase and unit cost).

**Navigation:** Project → Nguyên liệu tile pushes the list; "＋ Thêm" or the empty button pushes "Nguyên liệu mới", Lưu pops back. A row pushes the edit screen; Lưu or a confirmed delete pops back to the list.

## Acceptance Criteria

1. API test: a member creates an ingredient in each mode; empty or 61-character name, duplicate name (case-insensitive), quantity 0, negative price and an unknown mode are refused.
2. Unit test: kg→g and l→ml conversion; base quantity with 3 decimals.
3. API test: price stored as an integer; above-maximum values refused. Unit test: VND and USD minor units.
4. Unit test: unit-cost formatting per 1 (2 decimals) and per 10 (whole), VND and USD, e.g. 24.000 ₫ / 380 g → 63,16 ₫/g and 632 ₫/10 g.
5. API test: another member edits and deletes; deleting the project deletes its ingredients and history.
6. API test: the 301st ingredient is refused with `ingredient_limit_reached`.
7. API test: create records one history entry; changing price adds one; renaming adds none.
8. API test: after 7 purchase changes only the latest 5 entries remain, newest first.
9. API test: older edits don't overwrite newer per field and a stale purchase adds no entry; same id twice gives one ingredient; non-member `404`; signed out `401`.
10. Unit test: total sums the current price of each ingredient.
11. By hand, mockup 1a: tile with count; Sản phẩm still "Sắp có".
12. Unit test: A–Z Vietnamese sort. By hand, mockup 1b: hero and row layout.
13. By hand, mockups 1c–1d: fields per mode, live result, default switch.
14. Unit test: form validation messages. By hand, mockup 1e.
15. By hand, mockup 1f: history section collapsed by default, current entry marked; delete confirmation.
16. By hand, mockups 1h–1i.
17. Unit test: queued ingredient changes merge per field. By hand: offline create shows "Chờ lưu" and syncs after reconnect.
18. By hand: dark mode, EN text, VoiceOver row labels.
19. Check: `prisma migrate deploy` succeeds on an empty test database and on one with existing data.

## Out of Scope

- Using ingredients in products, blocking delete while used, cost updates of products (#13).
- Inventory or stock levels; suppliers; purchase dates other than the history timestamp.
- Converting between modes (weight ↔ volume) or between currencies.
- Custom portion names ("cái", "gói"); portions are always "phần".

## Open Questions

None. The mockup's 10 assumptions were approved by the user on 2026-11-19.
