import { describe, expect, it } from "vitest";

import { ingredient } from "../ingredients/fixtures";
import { extraCost, product, productSize } from "./fixtures";
import { defaultNames, ingredientLookup, joinNames, matchesQuery, parseTarget, pickSize, productRows, productsUsing, sizeFigures, toggleSize, validateName, withPriceChanges } from "./view";

const tra = ingredient({ id: "tra", name: "Trà đen", purchase: { quantity: 1000, unit: "g", price: 180000 } });
const ly = ingredient({ id: "ly", name: "Ly", mode: "portion", purchase: { quantity: 1, unit: "portion", price: 1500 } });
const lookup = ingredientLookup([tra, ly]);

const sizeM = productSize({
  size: "M",
  sellingPrice: 35000,
  lines: [
    { ingredientId: "tra", amount: 6, included: true, isDefault: false },
    { ingredientId: "ly", amount: 1, included: true, isDefault: true },
  ],
  extras: [{ id: "x1", name: "Đá", amount: 600, included: true, isDefault: true, extraCostId: "e1" }],
});

describe("sizeFigures", () => {
  it("splits the cost into recipe and extras and works out profit, margin and hint", () => {
    const f = sizeFigures(sizeM, lookup, 65, "VND");
    expect(f.recipeCost).toBe(2580);
    expect(f.extrasCost).toBe(600);
    expect(f.cost).toBe(3180);
    expect(f.profit).toBe(31820);
    expect(f.margin).toBe(91);
    expect(f.hint).toBe(10000);
    expect(f.belowTarget).toBe(false);
  });

  it("flags a margin below the target, and has no profit or margin without a price", () => {
    const low = sizeFigures({ ...sizeM, sellingPrice: 4000 }, lookup, 65, "VND");
    expect(low.margin).toBe(21);
    expect(low.belowTarget).toBe(true);
    const none = sizeFigures({ ...sizeM, sellingPrice: null }, lookup, 65, "VND");
    expect([none.profit, none.margin, none.belowTarget]).toEqual([null, null, false]);
    expect(none.hint).toBe(10000);
  });

  it("counts an unticked line as nothing", () => {
    const f = sizeFigures({ ...sizeM, lines: sizeM.lines.map((l) => ({ ...l, included: false })) }, lookup, 65, "VND");
    expect(f.recipeCost).toBe(0);
  });
});

describe("productRows", () => {
  it("sorts A-Z and summarises M, else the smallest size", () => {
    const rows = productRows(
      [
        product({ id: "b", name: "Trà sữa", sizes: [productSize({ size: "L" }), sizeM] }),
        product({ id: "a", name: "Cà phê", sizes: [productSize({ size: "L" }), productSize({ size: "S" })] }),
      ],
      lookup,
      65,
      "VND",
    );
    expect(rows.map((r) => r.name)).toEqual(["Cà phê", "Trà sữa"]);
    expect(rows[0].sizes).toEqual(["L", "S"]);
    expect(rows[0].summary?.size).toBe("S");
    expect(rows[1].summary?.size).toBe("M");
    expect(rows[1].summary?.figures.profit).toBe(31820);
  });
});

describe("productsUsing", () => {
  it("lists each product that uses the ingredient once, A-Z, even when a line is unticked", () => {
    const withTra = (id: string, name: string, included: boolean) =>
      product({
        id,
        name,
        sizes: [
          productSize({ size: "S", lines: [{ ingredientId: "tra", amount: 1, included, isDefault: false }] }),
          productSize({ size: "M", lines: [{ ingredientId: "tra", amount: 1, included, isDefault: false }] }),
        ],
      });
    const products = [withTra("2", "Trà sữa", true), withTra("1", "Trà đào", false), product({ id: "3", name: "Cà phê", sizes: [sizeM] }), product({ id: "4", name: "Nước", sizes: [productSize({ size: "M" })] })];
    expect(productsUsing("tra", products)).toEqual(["Cà phê", "Trà đào", "Trà sữa"]);
    expect(productsUsing("none", products)).toEqual([]);
  });
});

describe("joinNames", () => {
  it("joins with commas and the last word", () => {
    expect(joinNames([], "và")).toBe("");
    expect(joinNames(["A"], "và")).toBe("A");
    expect(joinNames(["A", "B"], "và")).toBe("A và B");
    expect(joinNames(["A", "B", "C"], "and")).toBe("A, B and C");
  });
});

describe("validateName", () => {
  it("trims, bounds the length and refuses a duplicate ignoring case", () => {
    expect(validateName("   ", [], 60)).toBe("nameEmpty");
    expect(validateName("a".repeat(61), [], 60)).toBe("nameTooLong");
    expect(validateName("  " + "a".repeat(60) + " ", [], 60)).toBeNull();
    expect(validateName("trà SỮA", ["Trà sữa"], 60)).toBe("nameDuplicate");
    expect(validateName("Trà đào", ["Trà sữa"], 60)).toBeNull();
  });
});

describe("pickSize", () => {
  it("keeps the wanted size while it exists, else M, else the first", () => {
    expect(pickSize(["S", "M", "L"], "L")).toBe("L");
    expect(pickSize(["S", "M"], "L")).toBe("M");
    expect(pickSize(["S", "L"], null)).toBe("S");
    expect(pickSize([], "M")).toBeNull();
  });
});

describe("toggleSize", () => {
  it("adds in S, M, L order and removes, but never the last one", () => {
    expect(toggleSize(["M"], "S")).toEqual(["S", "M"]);
    expect(toggleSize(["S", "M"], "L")).toEqual(["S", "M", "L"]);
    expect(toggleSize(["S", "M"], "S")).toEqual(["M"]);
    expect(toggleSize(["M"], "M")).toEqual(["M"]);
  });
});

describe("defaultNames", () => {
  it("lists default ingredients then default extra costs, oldest first", () => {
    const ingredients = [
      ingredient({ id: "b", name: "Nắp", isDefault: true, createdAt: "2026-11-02T00:00:00.000Z" }),
      ingredient({ id: "a", name: "Ly", isDefault: true, createdAt: "2026-11-01T00:00:00.000Z" }),
      ingredient({ id: "c", name: "Trà", isDefault: false }),
    ];
    const extras = [extraCost({ id: "e", name: "Đá", isDefault: true }), extraCost({ id: "f", name: "Khăn", isDefault: false })];
    expect(defaultNames(ingredients, extras)).toEqual(["Ly", "Nắp", "Đá"]);
  });
});

describe("parseTarget", () => {
  it("accepts a whole percent from 1 to 95 only", () => {
    expect(parseTarget("65")).toBe(65);
    expect(parseTarget(" 1 ")).toBe(1);
    expect(parseTarget("95")).toBe(95);
    expect(parseTarget("0")).toBeNull();
    expect(parseTarget("96")).toBeNull();
    expect(parseTarget("6,5")).toBeNull();
    expect(parseTarget("")).toBeNull();
  });
});

describe("matchesQuery", () => {
  it("ignores case and tone marks, and an empty search matches everything", () => {
    expect(matchesQuery("Trà đen", "tra den")).toBe(true);
    expect(matchesQuery("Trà đen", "ĐEN")).toBe(true);
    expect(matchesQuery("Sữa tươi", "tra")).toBe(false);
    expect(matchesQuery("Sữa tươi", "  ")).toBe(true);
  });
});

describe("withPriceChanges", () => {
  it("keeps only ingredients with more than one price entry", () => {
    const lookup = {
      a: { prices: [{ recordedAt: "1" }] },
      b: { prices: [{ recordedAt: "2" }, { recordedAt: "1" }] },
      c: undefined,
    };
    expect(Object.keys(withPriceChanges(lookup))).toEqual(["b"]);
  });
});
