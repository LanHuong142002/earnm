import { describe, expect, it } from "vitest";

import { validateIngredient } from "./validate";

const ok = { name: "Trà đen", quantity: 1, unit: "kg" as const, price: 180000 };
const run = (over: Partial<Parameters<typeof validateIngredient>[0]> = {}, existing: string[] = [], currency: "VND" | "USD" = "VND") =>
  validateIngredient({ ...ok, ...over }, existing, currency);

describe("validateIngredient", () => {
  it("accepts a valid form", () => {
    expect(run()).toEqual({});
  });

  it("flags empty and whitespace names", () => {
    expect(run({ name: "   " }).name).toBe("ingredients.errors.nameEmpty");
  });

  it("flags names over 60 characters", () => {
    expect(run({ name: "a".repeat(61) }).name).toBe("ingredients.errors.nameTooLong");
    expect(run({ name: "a".repeat(60) }).name).toBeUndefined();
  });

  it("flags duplicate names ignoring case and spacing", () => {
    expect(run({ name: " trà ĐEN " }, ["Trà đen"]).name).toBe("ingredients.errors.nameDuplicate");
    expect(run({ name: "Trà" }, ["Trà đen"]).name).toBeUndefined();
  });

  it("flags quantity not above 0", () => {
    expect(run({ quantity: 0 }).quantity).toBe("ingredients.errors.quantityPositive");
    expect(run({ quantity: -1 }).quantity).toBe("ingredients.errors.quantityPositive");
    expect(run({ quantity: Number.NaN }).quantity).toBe("ingredients.errors.quantityPositive");
    expect(run({ quantity: null }).quantity).toBe("ingredients.errors.quantityPositive");
  });

  it("flags quantity above 1.000.000 base units", () => {
    expect(run({ quantity: 1001, unit: "kg" }).quantity).toBe("ingredients.errors.quantityTooLarge");
    expect(run({ quantity: 1000, unit: "kg" }).quantity).toBeUndefined();
    expect(run({ quantity: 1000001, unit: "g" }).quantity).toBe("ingredients.errors.quantityTooLarge");
  });

  it("flags missing, negative and too large price", () => {
    expect(run({ price: null }).price).toBe("ingredients.errors.priceRequired");
    expect(run({ price: -1 }).price).toBe("ingredients.errors.priceNegative");
    expect(run({ price: 1000000001 }).price).toBe("ingredients.errors.priceTooLarge");
    expect(run({ price: 1000000000 }).price).toBeUndefined();
    expect(run({ price: 0 }).price).toBeUndefined();
  });

  it("uses the USD maximum of 100.000 $ in cents", () => {
    expect(run({ price: 10000001 }, [], "USD").price).toBe("ingredients.errors.priceTooLarge");
    expect(run({ price: 10000000 }, [], "USD").price).toBeUndefined();
  });

  it("refuses a price that is not whole minor units", () => {
    expect(run({ price: 100.49999999999999 }, [], "USD").price).toBe("ingredients.errors.priceDecimals");
    expect(run({ price: 1810 }, [], "USD").price).toBeUndefined();
    expect(run({ price: 1.5 }).price).toBe("ingredients.errors.priceDecimals");
  });
});
