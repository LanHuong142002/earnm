import { describe, expect, it } from "vitest";

import { hintPrice, latestPriceUpdate, lineCost, marginPct, profit, sizeCost } from "./cost";

const ing = (name: string, quantity: number, price: number, recordedAt?: string) => ({
  name,
  purchase: { quantity, price },
  prices: recordedAt ? [{ recordedAt }] : [],
});

const ingredients = {
  tra: ing("Trà đen", 1000, 180000),
  sua: ing("Sữa tươi", 1000, 38000),
  kem: ing("Bột kem béo", 1000, 95000),
  duong: ing("Đường", 1000, 22000),
  chau: ing("Trân châu", 1000, 45000),
  ly: ing("Ly", 1, 1500),
  nap: ing("Nắp", 1, 500),
  ong: ing("Ống hút", 1, 700),
};

const sizeM = [
  { ingredientId: "tra", amount: 6, included: true },
  { ingredientId: "sua", amount: 80, included: true },
  { ingredientId: "kem", amount: 15, included: true },
  { ingredientId: "duong", amount: 20, included: true },
  { ingredientId: "chau", amount: 50, included: true },
  { ingredientId: "ly", amount: 1, included: true },
  { ingredientId: "nap", amount: 1, included: true },
  { ingredientId: "ong", amount: 1, included: false },
];
const extras = [
  { amount: 600, included: true },
  { amount: 200, included: true },
];

describe("lineCost", () => {
  it("is price / quantity * amount", () => {
    expect(lineCost(ingredients.tra, 6)).toBe(1080);
    expect(lineCost(ingredients.sua, 80)).toBe(3040);
    expect(lineCost(ingredients.kem, 15)).toBe(1425);
    expect(lineCost(ingredients.ly, 1)).toBe(1500);
  });
  it("rounds to a whole minor unit", () => {
    expect(lineCost(ing("x", 3, 10), 1)).toBe(3);
    expect(lineCost(ing("x", 3, 20), 1)).toBe(7);
  });
  it("is 0 for an unusable purchase", () => {
    expect(lineCost(ing("x", 0, 10), 5)).toBe(0);
  });
});

describe("sizeCost", () => {
  it("sums ticked lines and extras only", () => {
    expect(sizeCost(sizeM, ingredients, extras)).toBe(11035);
  });
  it("ignores unticked extras and unknown ingredients", () => {
    expect(sizeCost([{ ingredientId: "gone", amount: 5, included: true }], ingredients, [{ amount: 600, included: false }])).toBe(0);
  });
});

describe("profit and margin", () => {
  it("computes profit", () => {
    expect(profit(35000, 11035)).toBe(23965);
  });
  it("rounds margin to a whole percent", () => {
    expect(marginPct(23965, 35000)).toBe(68);
  });
  it("is null without a price", () => {
    expect(marginPct(0, 0)).toBeNull();
    expect(marginPct(0, null)).toBeNull();
    expect(profit(null, 100)).toBeNull();
  });
});

describe("hintPrice", () => {
  it("rounds up to 1000 for VND", () => {
    expect(hintPrice(11035, 65, "VND")).toBe(32000);
    expect(hintPrice(3100, 65, "VND")).toBe(9000);
  });
  it("does not round up an exact multiple", () => {
    expect(hintPrice(3500, 50, "VND")).toBe(7000);
  });
  it("rounds up to 10 cents for USD", () => {
    expect(hintPrice(123, 65, "USD")).toBe(360);
    expect(hintPrice(350, 65, "USD")).toBe(1000);
  });
  it("is null for an impossible target", () => {
    expect(hintPrice(100, 100, "VND")).toBeNull();
  });
});

describe("latestPriceUpdate", () => {
  it("returns the most recent price entry among used ingredients", () => {
    const set = {
      a: ing("A", 1, 1, "2026-01-01T00:00:00Z"),
      b: ing("B", 1, 1, "2026-03-01T00:00:00Z"),
      c: ing("C", 1, 1, "2026-05-01T00:00:00Z"),
    };
    const lines = [{ ingredientId: "a" }, { ingredientId: "b" }];
    expect(latestPriceUpdate(lines, set)).toEqual({ ingredientName: "B", date: "2026-03-01T00:00:00Z" });
  });
  it("is null when nothing has a price entry", () => {
    expect(latestPriceUpdate([{ ingredientId: "tra" }], ingredients)).toBeNull();
    expect(latestPriceUpdate([], ingredients)).toBeNull();
  });
});
