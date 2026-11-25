import { describe, expect, it } from "vitest";
import { ingredient } from "../ingredients/fixtures";
import { extraCost } from "../products/fixtures";
import { draftEstimate, lineEstimate, missingForDone, type DraftLine } from "./estimate";

const purchase = (quantity: number, price: number) => ({ quantity, unit: "g" as const, price });

// Existing: Trà xanh nhài 120 ₫/g, Đường nước 30 ₫/ml. Defaults: a cup (portion, 2.600 ₫) and an extra of 500 ₫ = 3.100 ₫.
const ingredients = [
  ingredient({ id: "tea", name: "Trà xanh nhài", purchase: purchase(1000, 120000) }),
  ingredient({ id: "syrup", name: "Đường nước", mode: "volume", purchase: purchase(1000, 30000) }),
  ingredient({ id: "cup", name: "Ly", mode: "portion", isDefault: true, purchase: { quantity: 50, unit: "portion", price: 130000 } }),
  ingredient({ id: "ice", name: "Đá", mode: "weight", isDefault: true, purchase: purchase(1000, 1000) }),
];
const extras = [extraCost({ id: "x1", name: "Ống hút", amount: 500, isDefault: true }), extraCost({ id: "x2", name: "Khác", amount: 900 })];

const tea: DraftLine = { kind: "existing", ingredientId: "tea", amount: 5 };
const lychee: DraftLine = { kind: "new", newName: "Vải ngâm", newKind: "weight", purchaseQty: 565, purchasePrice: 45000, amount: 60 };
const rose: DraftLine = { kind: "new", newName: "Siro hoa hồng", newKind: "volume", purchaseQty: 750, purchasePrice: 180000, amount: 15 };
const sugar: DraftLine = { kind: "existing", ingredientId: "syrup", amount: 20 };
const roseNoPrice: DraftLine = { ...rose, purchaseQty: null, purchasePrice: null };

describe("lineEstimate", () => {
  it("prices an existing line from the ingredient", () => {
    expect(lineEstimate(tea, ingredients)).toBe(600);
    expect(lineEstimate(sugar, ingredients)).toBe(600);
  });
  it("prices a new line from its purchase, rounded to a whole minor unit", () => {
    expect(lineEstimate(lychee, ingredients)).toBe(4779);
    expect(lineEstimate(rose, ingredients)).toBe(3600);
  });
  it("is null for a new line without quantity or price", () => {
    expect(lineEstimate(roseNoPrice, ingredients)).toBeNull();
    expect(lineEstimate({ ...rose, purchasePrice: null }, ingredients)).toBeNull();
    expect(lineEstimate({ ...rose, purchaseQty: null }, ingredients)).toBeNull();
  });
  it("is null for an existing line whose ingredient is gone", () => {
    expect(lineEstimate({ kind: "existing", ingredientId: "gone", amount: 5 }, ingredients)).toBeNull();
  });
});

describe("draftEstimate", () => {
  const ctx = (lines: DraftLine[], expectedPrice: number | null = 39000) => ({ lines, ingredients, extraCosts: extras, expectedPrice, targetMargin: 60 });

  it("adds the recipe and the defaults: 9.579 and 12.679, profit 26.321, margin 67%", () => {
    const e = draftEstimate(ctx([tea, lychee, rose, sugar]));
    expect(e.recipeCost).toBe(9579);
    expect(e.defaultsCost).toBe(3100);
    expect(e.total).toBe(12679);
    expect(e.missingPrices).toEqual([]);
    expect(e.profit).toBe(26321);
    expect(e.marginPct).toBe(67);
  });
  it("has no estimate and names the new lines lacking a price", () => {
    const e = draftEstimate(ctx([tea, lychee, roseNoPrice, sugar]));
    expect(e.total).toBeNull();
    expect(e.missingPrices).toEqual(["Siro hoa hồng"]);
    expect(e.profit).toBeNull();
    expect(e.marginPct).toBeNull();
  });
  it("has no profit or margin without an expected price", () => {
    const e = draftEstimate(ctx([tea, lychee, rose, sugar], null));
    expect(e.total).toBe(12679);
    expect(e.profit).toBeNull();
    expect(e.marginPct).toBeNull();
  });
  it("does not count a default twice when the draft already uses it", () => {
    const e = draftEstimate(ctx([{ kind: "existing", ingredientId: "cup", amount: 1 }]));
    expect(e.recipeCost).toBe(2600);
    expect(e.defaultsCost).toBe(500);
    expect(e.total).toBe(3100);
  });
  it("counts a default ingredient once when the draft has it as an existing line (the draft amount replaces the default)", () => {
    const e = draftEstimate(ctx([{ kind: "existing", ingredientId: "cup", amount: 2 }]));
    expect(e.recipeCost).toBe(5200);
    expect(e.defaultsCost).toBe(500); // Đá starts at 0 g, plus the extra
  });
  it("skips a default whose name a new line already uses, ignoring case", () => {
    const iceLine: DraftLine = { kind: "new", newName: " ĐÁ ", newKind: "weight", purchaseQty: 1000, purchasePrice: 1000, amount: 100 };
    const e = draftEstimate(ctx([iceLine]));
    expect(e.recipeCost).toBe(100);
    expect(e.defaultsCost).toBe(2600 + 500);
  });
  it("has no estimate and counts the line when an existing line's ingredient is gone", () => {
    const e = draftEstimate(ctx([tea, { kind: "existing", ingredientId: "gone", amount: 5 }]));
    expect(e.total).toBeNull();
    expect(e.missingIngredients).toBe(1);
    expect(e.missingPrices).toEqual([]);
    expect(e.profit).toBeNull();
  });
  it("works with no lines", () => {
    const e = draftEstimate(ctx([]));
    expect(e.recipeCost).toBe(0);
    expect(e.total).toBe(3100);
  });
});

describe("missingForDone", () => {
  const ok = { name: "Trà vải", sizes: ["M", "L"], lines: [tea, lychee] };
  it("is empty for a complete draft", () => expect(missingForDone(ok)).toEqual([]));
  it("lists name, sizes and lines", () => {
    expect(missingForDone({ name: "  ", sizes: [], lines: [] })).toEqual([{ code: "name" }, { code: "sizes" }, { code: "lines" }]);
  });
  it("lists the quantity and price missing on each new line", () => {
    expect(missingForDone({ ...ok, lines: [tea, { ...rose, purchaseQty: null, purchasePrice: null }, { ...lychee, purchasePrice: null }] })).toEqual([
      { code: "newLineQty", name: "Siro hoa hồng" },
      { code: "newLinePrice", name: "Siro hoa hồng" },
      { code: "newLinePrice", name: "Vải ngâm" },
    ]);
  });
});
