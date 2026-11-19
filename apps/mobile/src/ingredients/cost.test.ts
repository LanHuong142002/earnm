import { describe, expect, it } from "vitest";

import { per1, per10, toBase, totalSpent, unitCost } from "./cost";

describe("toBase", () => {
  it("converts kg to g and l to ml", () => {
    expect(toBase(1.5, "kg")).toBe(1500);
    expect(toBase(2, "l")).toBe(2000);
    expect(toBase(380, "g")).toBe(380);
    expect(toBase(250, "ml")).toBe(250);
    expect(toBase(3, "portion")).toBe(3);
  });

  it("keeps up to 3 decimals without float drift", () => {
    expect(toBase(0.001, "kg")).toBe(1);
    expect(toBase(1.005, "kg")).toBe(1005);
    expect(toBase(0.1 + 0.2, "g")).toBe(0.3);
    expect(toBase(380.123, "g")).toBe(380.123);
    expect(toBase(2.675, "portion")).toBe(2.675);
  });
});

describe("unit cost", () => {
  it("computes per 1 (2 decimals) and per 10 (whole minor unit)", () => {
    expect(unitCost(24000, 380)).toBeCloseTo(63.1579, 3);
    expect(per1(24000, 380)).toBe(63.16);
    expect(per10(24000, 380)).toBe(632);
  });

  it("works for USD cents", () => {
    expect(per1(1250, 500)).toBe(2.5);
    expect(per10(1250, 500)).toBe(25);
  });

  it("returns null when it cannot be computed", () => {
    expect(per1(100, 0)).toBeNull();
    expect(per10(100, -1)).toBeNull();
    expect(unitCost(100, Number.NaN)).toBeNull();
  });
});

describe("totalSpent", () => {
  it("sums the current price of every ingredient", () => {
    expect(totalSpent([{ price: 24000 }, { price: 180000 }, { price: 0 }])).toBe(204000);
    expect(totalSpent([])).toBe(0);
  });
});
