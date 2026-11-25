import { describe, expect, it } from "vitest";
import { ingredient } from "../ingredients/fixtures";
import { draftEstimate } from "./estimate";
import { draft, draftLine } from "./fixtures";
import {
  convertErrorKey,
  convertSplit,
  estimateLines,
  baseSize,
  convertedHeader,
  draftsUsing,
  groupDrafts,
  missingItems,
  reuseTexts,
  rowSummary,
  unconvertedCount,
  unitPriceText,
} from "./view";

describe("groupDrafts", () => {
  it("puts Done first, then Working, and converted drafts apart, newest first", () => {
    const all = [
      draft({ id: "w1", status: "working", createdAt: "2026-11-01T00:00:00.000Z" }),
      draft({ id: "d1", status: "done", createdAt: "2026-11-02T00:00:00.000Z" }),
      draft({ id: "w2", status: "working", createdAt: "2026-11-05T00:00:00.000Z" }),
      draft({ id: "c1", status: "done", convertedAt: "2026-11-20T00:00:00.000Z", productId: "pr1" }),
      draft({ id: "d2", status: "done", createdAt: "2026-11-09T00:00:00.000Z" }),
    ];
    const groups = groupDrafts(all);
    expect(groups.done.map((d) => d.id)).toEqual(["d2", "d1"]);
    expect(groups.working.map((d) => d.id)).toEqual(["w2", "w1"]);
    expect(groups.converted.map((d) => d.id)).toEqual(["c1"]);
  });

  it("keeps a converted draft whose product was deleted in the converted group", () => {
    const gone = draft({ id: "c2", status: "done", productId: null, convertedAt: "2026-11-20T00:00:00.000Z" });
    expect(groupDrafts([gone]).converted).toHaveLength(1);
    expect(groupDrafts([gone]).done).toHaveLength(0);
  });

  it("breaks a tie on the id so the order is stable", () => {
    const a = draft({ id: "a" });
    const b = draft({ id: "b" });
    expect(groupDrafts([b, a]).working.map((d) => d.id)).toEqual(["a", "b"]);
  });
});

describe("unconvertedCount", () => {
  it("counts the drafts that are not converted", () => {
    const all = [draft({ id: "1" }), draft({ id: "2", status: "done" }), draft({ id: "3", convertedAt: "2026-11-20T00:00:00.000Z" })];
    expect(unconvertedCount(all)).toBe(2);
  });
});

const tea = ingredient({ id: "tea", name: "Trà xanh nhài", purchase: { quantity: 1000, unit: "g", price: 120000 } });

describe("estimateLines", () => {
  it("maps rows to estimate lines and drops a row that cannot be read", () => {
    const rows = [
      draftLine({ id: "1", kind: "existing", ingredientId: "tea", amount: 5 }),
      draftLine({ id: "2", kind: "new", ingredientId: null, newName: "Vải", newKind: "weight", purchaseQty: 565, purchasePrice: 45000, amount: 60 }),
      draftLine({ id: "3", kind: "existing", ingredientId: null, amount: 1 }),
      draftLine({ id: "4", kind: "new", ingredientId: null, newName: null, newKind: null, amount: 1 }),
    ];
    expect(estimateLines(rows)).toEqual([
      { kind: "existing", ingredientId: "tea", amount: 5 },
      { kind: "new", newName: "Vải", newKind: "weight", purchaseQty: 565, purchasePrice: 45000, amount: 60 },
    ]);
  });
});

describe("rowSummary", () => {
  const input = (lines: ReturnType<typeof estimateLines>) => draftEstimate({ lines, ingredients: [tea], extraCosts: [], expectedPrice: null, targetMargin: 65 });

  it("says there is no recipe when there are no lines", () => {
    expect(rowSummary(draft({ id: "1" }), input([]))).toEqual({ kind: "noRecipe" });
  });

  it("counts the new lines that lack a price", () => {
    const d = draft({ id: "1", lines: [draftLine({ id: "a", kind: "new", ingredientId: null, newName: "Siro", newKind: "volume", amount: 15 })] });
    expect(rowSummary(d, input(estimateLines(d.lines)))).toEqual({ kind: "missing", count: 1 });
  });

  it("gives the estimated cost when every price is known", () => {
    const d = draft({ id: "1", lines: [draftLine({ id: "a", ingredientId: "tea", amount: 5 })] });
    expect(rowSummary(d, input(estimateLines(d.lines)))).toEqual({ kind: "cost", total: 600 });
  });
});

describe("convertSplit", () => {
  const existing = [
    { name: "Vải ngâm", mode: "weight" as const, purchase: { quantity: 1000, unit: "g" as const, price: 79650 } },
    { name: "Đường nước", mode: "volume" as const, purchase: { quantity: 1000, unit: "ml" as const, price: 20000 } },
  ];
  it("reuses a new line whose name now matches an ingredient, ignoring case, and creates the rest", () => {
    const lines = [
      draftLine({ id: "1", kind: "new", ingredientId: null, newName: "vải NGÂM", newKind: "weight", amount: 60 }),
      draftLine({ id: "2", kind: "new", ingredientId: null, newName: "Siro hoa hồng", newKind: "volume", amount: 15 }),
      draftLine({ id: "3", kind: "existing", ingredientId: "tea", amount: 5 }),
    ];
    expect(convertSplit(lines, existing)).toEqual({
      create: ["Siro hoa hồng"],
      reuse: [{ name: "vải NGÂM", purchase: existing[0].purchase }],
      mismatch: [],
    });
  });

  it("flags a new line whose same-name ingredient is counted a different way", () => {
    const purchase = { quantity: 500, unit: "g" as const, price: 1000 };
    const known = [{ name: "Siro hoa hồng", mode: "weight" as const, purchase }, { name: "Vải ngâm", mode: "weight" as const, purchase }];
    const lines = [
      draftLine({ id: "1", kind: "new", ingredientId: null, newName: "siro HOA hồng", newKind: "volume", amount: 15 }),
      draftLine({ id: "2", kind: "new", ingredientId: null, newName: "Vải ngâm", newKind: "weight", amount: 60 }),
    ];
    expect(convertSplit(lines, known)).toEqual({ create: [], reuse: [{ name: "Vải ngâm", purchase }], mismatch: ["siro HOA hồng"] });
  });

  it("is empty when the draft only uses existing ingredients", () => {
    expect(convertSplit([draftLine({ id: "1" })], existing)).toEqual({ create: [], reuse: [], mismatch: [] });
  });
});

describe("missingItems", () => {
  it("lists what a draft lacks, one item for a new line missing its price", () => {
    expect(
      missingItems([
        { code: "lines" },
        { code: "newLinePrice", name: "Siro hoa hồng" },
      ]),
    ).toEqual([{ kind: "lines" }, { kind: "price", name: "Siro hoa hồng" }]);
  });

  it("merges quantity and price of one line into a price item", () => {
    expect(missingItems([{ code: "newLineQty", name: "Siro" }, { code: "newLinePrice", name: "Siro" }])).toEqual([{ kind: "price", name: "Siro" }]);
  });

  it("keeps a quantity-only item", () => {
    expect(missingItems([{ code: "newLineQty", name: "Siro" }])).toEqual([{ kind: "qty", name: "Siro" }]);
  });
});

describe("convertErrorKey", () => {
  it("maps each convert code to its own notice", () => {
    expect(convertErrorKey("offline")).toBe("drafts.convertErrors.offline");
    expect(convertErrorKey("product_name_taken")).toBe("drafts.convertErrors.nameTaken");
    expect(convertErrorKey("pending")).toBe("drafts.convertErrors.pending");
    expect(convertErrorKey("product_limit_reached")).toBe("drafts.convertErrors.productLimit");
    expect(convertErrorKey("ingredient_limit_reached")).toBe("drafts.convertErrors.ingredientLimit");
    expect(convertErrorKey("draft_converted")).toBe("drafts.convertErrors.converted");
    expect(convertErrorKey("draft_not_done")).toBe("drafts.convertErrors.notDone");
    expect(convertErrorKey("draft_ingredient_mode_mismatch")).toBe("drafts.convertErrors.modeMismatch");
    expect(convertErrorKey("draft_line_amount_too_large")).toBe("drafts.convertErrors.amountTooLarge");
    expect(convertErrorKey("draft_incomplete")).toBe("drafts.convertErrors.incomplete");
    expect(convertErrorKey("not_signed_in")).toBe("drafts.convertErrors.notSignedIn");
  });

  it("falls back to a generic notice", () => {
    expect(convertErrorKey("internal_error")).toBe("drafts.convertErrors.generic");
    expect(convertErrorKey("whatever")).toBe("drafts.convertErrors.generic");
  });
});

describe("unitPriceText", () => {
  it("shows the price of one base unit", () => {
    expect(unitPriceText({ quantity: 750, price: 180000 }, "VND", "ml")).toBe("240 ₫/ml");
    expect(unitPriceText({ quantity: 1000, price: 210000 }, "VND", "ml")).toBe("210 ₫/ml");
  });

  it("keeps decimals of a cheap unit", () => {
    expect(unitPriceText({ quantity: 565, price: 45000 }, "VND", "g")).toBe("79,65 ₫/g");
  });

  it("is empty when there is nothing to divide by", () => {
    expect(unitPriceText({ quantity: 0, price: 100 }, "VND", "g")).toBe("");
  });
});

describe("baseSize", () => {
  it("is the smallest chosen size whatever the order", () => {
    expect(baseSize(["L", "M"])).toBe("M");
    expect(baseSize(["L"])).toBe("L");
    expect(baseSize(["M", "S"])).toBe("S");
  });
  it("is null without sizes", () => {
    expect(baseSize([])).toBeNull();
  });
});

describe("reuseTexts", () => {
  it("names each reused ingredient with the unit price it keeps, not the draft's", () => {
    const reuse = [{ name: "Vải ngâm", purchase: { quantity: 1000, unit: "g" as const, price: 79650 } }];
    const texts = reuseTexts(reuse, "VND", (name, price) => `${name} | ${price}`, () => "g");
    expect(texts).toEqual(["Vải ngâm | 79,65 ₫/g"]);
  });
});

describe("convertedHeader", () => {
  it("counts the server's converted total and says when the list shows fewer", () => {
    expect(convertedHeader(50, 73)).toEqual({ count: 73, capped: true });
    expect(convertedHeader(3, 3)).toEqual({ count: 3, capped: false });
    expect(convertedHeader(3, null)).toEqual({ count: 3, capped: false });
    expect(convertedHeader(4, 2)).toEqual({ count: 4, capped: false });
  });
});

describe("draftsUsing", () => {
  it("names the unconverted drafts with a line on the ingredient, once each, in order", () => {
    const on = (id: string) => [draftLine({ id: `l-${id}`, kind: "existing", ingredientId: "milk" })];
    const drafts = [
      draft({ id: "d1", name: "Trà vải hoa hồng", lines: on("1") }),
      draft({ id: "d2", name: "Cà phê", lines: [draftLine({ id: "x", kind: "existing", ingredientId: "tea" })] }),
      draft({ id: "d3", name: "Atiso", lines: [...on("3"), draftLine({ id: "l-3b", kind: "existing", ingredientId: "milk" })] }),
      draft({ id: "d4", name: "Đã chuyển", convertedAt: "2026-11-20T00:00:00.000Z", lines: on("4") }),
    ];
    expect(draftsUsing("milk", drafts)).toEqual(["Atiso", "Trà vải hoa hồng"]);
    expect(draftsUsing("none", drafts)).toEqual([]);
  });
});
