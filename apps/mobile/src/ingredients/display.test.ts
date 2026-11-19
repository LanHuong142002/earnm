import { describe, expect, it } from "vitest";

import {
  changeMode,
  displayQuantity,
  emptyIngredientForm,
  formatPriceText,
  formatQuantity,
  formFromIngredient,
  liveResult,
  moneyOf,
  parsePriceText,
  parseQuantityText,
  purchaseFromForm,
  unitsFor,
  validationInput,
} from "./display";
import { ingredient } from "./fixtures";

describe("displayQuantity", () => {
  it("divides base units by 1000 for kg and l", () => {
    expect(displayQuantity(1500, "kg")).toBe(1.5);
    expect(displayQuantity(2000, "l")).toBe(2);
    expect(displayQuantity(1, "kg")).toBe(0.001);
  });

  it("shows g, ml and portions as they are", () => {
    expect(displayQuantity(380, "g")).toBe(380);
    expect(displayQuantity(250, "ml")).toBe(250);
    expect(displayQuantity(50, "portion")).toBe(50);
  });
});

describe("formatQuantity", () => {
  it("uses a decimal comma, up to 3 decimals and dots between thousands", () => {
    expect(formatQuantity(1.5)).toBe("1,5");
    expect(formatQuantity(1)).toBe("1");
    expect(formatQuantity(0.001)).toBe("0,001");
    expect(formatQuantity(1500)).toBe("1.500");
    expect(formatQuantity(1234.5)).toBe("1.234,5");
  });
});

describe("parseQuantityText", () => {
  it("accepts a comma or a dot as the decimal mark", () => {
    expect(parseQuantityText("1,5")).toBe(1.5);
    expect(parseQuantityText("1.5")).toBe(1.5);
    expect(parseQuantityText(" 380 ")).toBe(380);
  });

  it("returns null for empty or non-numeric text", () => {
    expect(parseQuantityText("")).toBeNull();
    expect(parseQuantityText("abc")).toBeNull();
    expect(parseQuantityText("1,2,3")).toBeNull();
  });
});

describe("price text", () => {
  it("reads VND as whole dong and ignores separators", () => {
    expect(parsePriceText("180.000", "VND")).toBe(180000);
    expect(parsePriceText("", "VND")).toBeNull();
    expect(parsePriceText("0", "VND")).toBe(0);
  });

  it("reads USD as dollars and returns cents", () => {
    expect(parsePriceText("12,5", "USD")).toBe(1250);
    expect(parsePriceText("12.34", "USD")).toBe(1234);
    expect(parsePriceText("0.1", "USD")).toBe(10);
    expect(parsePriceText("", "USD")).toBeNull();
  });

  it("groups VND digits with dots and leaves USD text alone", () => {
    expect(formatPriceText("1800000", "VND")).toBe("1.800.000");
    expect(formatPriceText("12a", "VND")).toBe("12");
    expect(formatPriceText("12,5", "USD")).toBe("12,5");
  });
});

describe("moneyOf", () => {
  it("formats VND dong and USD cents", () => {
    expect(moneyOf(180000, "VND")).toBe("180.000 ₫");
    expect(moneyOf(1800, "USD")).toBe("$18.00");
  });
});

describe("unitsFor", () => {
  it("offers kg/g for weight, l/ml for volume and portion for portion", () => {
    expect(unitsFor("weight")).toEqual(["kg", "g"]);
    expect(unitsFor("volume")).toEqual(["l", "ml"]);
    expect(unitsFor("portion")).toEqual(["portion"]);
  });
});

describe("form state", () => {
  it("starts empty in weight mode", () => {
    expect(emptyIngredientForm()).toMatchObject({ name: "", mode: "weight", unit: "g", quantityText: "", priceText: "", isDefault: false });
  });

  it("fills from an ingredient, showing the remembered unit", () => {
    const form = formFromIngredient(
      ingredient({ id: "a", name: "Trà đen", purchase: { quantity: 1500, unit: "kg", price: 180000 }, isDefault: true }),
      "VND",
    );
    expect(form).toEqual({ name: "Trà đen", mode: "weight", quantityText: "1,5", unit: "kg", priceText: "180.000", isDefault: true });
  });

  it("fills USD prices as dollars", () => {
    const form = formFromIngredient(ingredient({ id: "a", purchase: { quantity: 500, unit: "g", price: 1250 } }), "USD");
    expect(form.priceText).toBe("12,5");
  });

  it("changing mode picks that mode's default unit and keeps the typed text", () => {
    const form = { ...emptyIngredientForm(), quantityText: "2", priceText: "10" };
    expect(changeMode(form, "volume")).toMatchObject({ mode: "volume", unit: "ml", quantityText: "2", priceText: "10" });
    expect(changeMode(form, "portion")).toMatchObject({ mode: "portion", unit: "portion" });
  });

  it("builds the purchase in base units", () => {
    const form = { ...emptyIngredientForm(), unit: "kg" as const, quantityText: "1,5", priceText: "180.000" };
    expect(purchaseFromForm(form, "VND")).toEqual({ quantity: 1500, unit: "kg", price: 180000 });
  });

  it("builds no purchase while quantity or price is missing", () => {
    expect(purchaseFromForm({ ...emptyIngredientForm(), quantityText: "1" }, "VND")).toBeNull();
    expect(purchaseFromForm({ ...emptyIngredientForm(), priceText: "5" }, "VND")).toBeNull();
  });

  it("maps to the validator input", () => {
    const form = { ...emptyIngredientForm(), name: " A ", quantityText: "2", priceText: "5" };
    expect(validationInput(form, "VND")).toEqual({ name: " A ", quantity: 2, unit: "g", price: 5 });
  });
});

describe("liveResult", () => {
  it("gives cost per 1 and per 10 base units", () => {
    const form = { ...emptyIngredientForm(), quantityText: "380", priceText: "24.000" };
    expect(liveResult(form, "VND")).toEqual({ per1: 63.16, per10: 632 });
  });

  it("converts kg before dividing", () => {
    const form = { ...emptyIngredientForm(), unit: "kg" as const, quantityText: "1", priceText: "180.000" };
    expect(liveResult(form, "VND")).toEqual({ per1: 180, per10: 1800 });
  });

  it("is null while it can't be computed", () => {
    expect(liveResult(emptyIngredientForm(), "VND")).toBeNull();
    expect(liveResult({ ...emptyIngredientForm(), quantityText: "0", priceText: "5" }, "VND")).toBeNull();
    expect(liveResult({ ...emptyIngredientForm(), quantityText: "5" }, "VND")).toBeNull();
  });
});
