# Spec: Members can build products and see the cost of each cup

Ticket: #13 (Epic F12). Tier: Feature. Sensitive Areas: data, schema, money, api. Builds on #12 (branch `claude/ourkit-spec-12-ingredients`). Mockup: `.ourkit/mockups/claude-ourkit-spec-13-products.html` (bản 1, group 2 "Sản phẩm", frames 2a–2k; approved by the user on 2026-11-19 with its 10 assumptions). Mode: Hands-off.

## Goal

Each project gets a products list. A product has sizes S, M and/or L; each size has a recipe (ingredients and amounts), extra costs (ice, water…) and a selling price. The app shows the cost of one cup, the profit and margin, and a quiet price hint for the project's target margin, so partners set prices that make a profit (Decisions 8, 10, 12). Costs always follow the ingredients' current prices from #12.

## Requirements

### Products and sizes

1. A project member can create a product with a name 1–60 characters (trimmed, unique in the project ignoring case) and at least one of the sizes S, M, L. Any member can rename it, add or remove sizes (at least one stays), and delete it after confirming; deleting removes its sizes, recipes and prices but never ingredients.
2. A project holds at most 200 products; one more is refused with `product_limit_reached`.
3. Each size has an optional selling price (integer minor units, 0 … 1.000.000.000 ₫ or 100.000 $).

### Recipe and extra costs

4. A recipe line links a size to one of the project's ingredients with an amount in that ingredient's base unit (g, ml or phần; > 0, up to 3 decimals, ≤ 100.000). An ingredient appears at most once per size.
5. When a size is created, every ingredient marked **default** gets a line, ticked, with amount 1 for portion mode and 0 for weight/volume (to be filled in). Default lines can be unticked (not counted) but not removed; other lines are added from a searchable picker (2e) and removed (2d).
6. The project has a list of **extra costs** (name 1–40, amount per cup, default flag), max 50. When a size is created, each default extra cost is copied into it, ticked, with its amount. A size's extra lines can be unticked, have their amount changed, and extra costs can be added to a size from the list. Changing or deleting a project extra cost does not change existing sizes.
7. Marking an ingredient or extra cost default later does not add it to existing sizes.
8. An ingredient used in any recipe line can't be deleted: the API refuses with `ingredient_in_use` and the phone shows the names of the products using it (1g).

### Cost, profit and hint

9. Line cost = ingredient unit cost × amount, rounded to the whole minor unit. Size cost = sum of ticked recipe lines + ticked extra lines.
10. Profit = selling price − cost. Margin = profit ÷ selling price, shown as a whole percent. Without a selling price, only the cost is shown (2g′).
11. The project has a **target margin** (whole percent 1–95, default 65), changed by any member from the hint. Hint price = cost ÷ (1 − target), rounded up to 1.000 ₫ (VND) or 0,10 $ (USD), shown as one small line: "Muốn lãi 65%: bán từ 32.000 ₫".
12. Costs are computed from current ingredient prices whenever shown; when an ingredient's price changes, every product using it shows the new cost and a quiet line "Giá vốn cập nhật <ngày> theo giá mới của <nguyên liệu>" (latest such change).

### Sync and access

13. Edits resolve last-write-wins per field: product name, size set, and per size: selling price and the whole recipe+extras list. Same id twice is idempotent; non-members `404`; signed out `401`.
14. Offline: "Đang ngoại tuyến"; changes queue and show "Chờ lưu"; refused changes show the existing rejected notice.

### On the phone

15. Project screen: the **Sản phẩm** tile is enabled with "n món" (1a).
16. Products list (2a): "Chi phí thêm" row on top, then products A–Z with sizes, selling price and profit of size M (else the smallest size); below-target margins get a small "· dưới 65%" note, never red. "＋ Mới" in the header.
17. Product screen (2b): size segmented control, hero card with profit per cup (or cost when no price), selling price row with the hint line, collapsed "Công thức · n" and "Chi phí thêm · n" sections showing their totals, the price-update line, "•••" menu (rename, add/remove size, delete).
18. Opened sections (2c): default lines with tick box and "Mặc định" chip, other lines tappable, "＋ Thêm nguyên liệu", "＋ Thêm chi phí", total cost of the size.
19. Sheets: edit line amount with live cost and "Bỏ khỏi công thức" (2d), ingredient picker with search and "Đã có" greyed (2e), selling price with live profit and hint (2f), target margin.
20. New product (2g): name, size pills (round), note listing defaults, "Tạo sản phẩm" → product screen (2g′).
21. Extra costs screen (2h): list with default switch, add/edit/delete.
22. Delete confirm (2i), empty list with link to ingredients (2j), loading/error like 1i, dark mode (2k); VI and EN, 44pt targets, accessible names.

**Navigation:** Project → Sản phẩm tile pushes the list; "＋ Mới" pushes "Sản phẩm mới", Tạo replaces it with the product screen; back returns to the list. A row pushes the product screen; sheets open over it and close with Lưu/Xong or swipe down; a confirmed delete pops to the list. "Chi phí thêm" row pushes its screen. "Thêm nguyên liệu trước" pushes the ingredients list.

## Acceptance Criteria

1. API test: create with name and sizes; empty/duplicate name and no sizes refused; rename, remove a size (not the last), delete keeps ingredients.
2. API test: the 201st product is refused with `product_limit_reached`.
3. API test: selling price stored as integer; out-of-range refused.
4. API test: recipe line with a foreign ingredient, duplicate ingredient or amount 0 on a non-default line refused.
5. API test: a new size gets ticked default ingredient lines (portion amount 1, others 0); unticking works; removing a default line refused.
6. API test: a new size copies default extra costs; changing the project extra cost leaves the size unchanged; 51st extra cost refused.
7. API test: marking an ingredient default later doesn't change existing sizes.
8. API test: deleting a used ingredient returns `409 ingredient_in_use` with product names. By hand, mockup 1g.
9. Unit test: line and size cost with rounding; unticked lines excluded.
10. Unit test: profit and margin; no-price case.
11. Unit test: hint rounding VND to 1.000 and USD to 0,10; target 1–95 enforced (API test).
12. Unit test: cost recomputes after an ingredient price change and the update line names the latest one.
13. API test: per-field LWW for name, sizes, price and recipe list; same id twice idempotent; non-member `404`; signed out `401`.
14. Unit test: queued product changes merge per field. By hand: offline "Chờ lưu" then sync.
15. By hand, mockup 1a: Sản phẩm tile enabled with count.
16. Unit test: list order and which size is summarised. By hand, mockup 2a.
17. By hand, mockups 2b and 2g′.
18. By hand, mockup 2c.
19. By hand, mockups 2d, 2e, 2f.
20. By hand, mockup 2g: round size pills.
21. By hand, mockup 2h.
22. By hand, mockups 2i, 2j, 2k; EN text; VoiceOver.
23. Check: `prisma migrate deploy` succeeds on an empty test database and on one with #12's data.

## Out of Scope

- Fixed costs in the cost (#14).
- Creating a product from an idea (#15).
- Copying a recipe between sizes, sizes other than S/M/L, product photos, sales tracking.
- Changing existing sizes when defaults change.

## Open Questions

None. The mockup's 10 assumptions were approved by the user on 2026-11-19.
