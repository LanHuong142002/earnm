import { describe, expect, it } from "vitest";
import { emptyNewLineForm, lineCostText, parseNewLine, type NewLineForm } from "./newLine";

const form = (over: Partial<NewLineForm> = {}): NewLineForm => ({ ...emptyNewLineForm(), name: "Siro hoa hồng", mode: "volume", unit: "ml", qtyText: "750", priceText: "180.000", amountText: "15", ...over });

describe("parseNewLine", () => {
  it("reads a complete new ingredient line in base units and minor units", () => {
    expect(parseNewLine(form(), "VND", [])).toEqual({
      ok: true,
      value: { newName: "Siro hoa hồng", newKind: "volume", purchaseQty: 750, purchasePrice: 180000, amount: 15 },
    });
  });

  it("converts kg and l to g and ml", () => {
    const r = parseNewLine(form({ mode: "weight", unit: "kg", qtyText: "1,5" }), "VND", []);
    expect(r.ok && r.value.purchaseQty).toBe(1500);
  });

  it("lets purchase quantity and price stay empty", () => {
    const r = parseNewLine(form({ qtyText: "", priceText: "" }), "VND", []);
    expect(r).toEqual({ ok: true, value: { newName: "Siro hoa hồng", newKind: "volume", purchaseQty: null, purchasePrice: null, amount: 15 } });
  });

  it("refuses an empty name, a taken name (ignoring case) and a missing amount", () => {
    expect(parseNewLine(form({ name: " " }), "VND", [])).toMatchObject({ ok: false, errors: { name: "nameEmpty" } });
    expect(parseNewLine(form({ name: "siro HOA hồng" }), "VND", ["Siro hoa hồng"])).toMatchObject({ ok: false, errors: { name: "nameDuplicate" } });
    expect(parseNewLine(form({ amountText: "" }), "VND", [])).toMatchObject({ ok: false, errors: { amount: "invalid" } });
    expect(parseNewLine(form({ amountText: "0" }), "VND", [])).toMatchObject({ ok: false, errors: { amount: "zero" } });
  });

  it("refuses a typed quantity or price that is not positive", () => {
    expect(parseNewLine(form({ qtyText: "0" }), "VND", [])).toMatchObject({ ok: false, errors: { qty: "invalid" } });
    expect(parseNewLine(form({ priceText: "0" }), "VND", [])).toMatchObject({ ok: false, errors: { price: "invalid" } });
  });
});

describe("lineCostText", () => {
  it("gives the unit price and the cost of the amount", () => {
    expect(lineCostText(form(), "VND")).toEqual({ perUnit: 240, amount: 15, cost: 3600 });
  });

  it("is null while the purchase or the amount is not readable", () => {
    expect(lineCostText(form({ priceText: "" }), "VND")).toBeNull();
    expect(lineCostText(form({ amountText: "x" }), "VND")).toBeNull();
  });
});
