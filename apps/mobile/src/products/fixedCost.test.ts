import { describe, expect, it } from "vitest";

import { fixedTotal, fullCost, kindMonthsChanges, monthlyAmount, perCupShare } from "./fixedCost";
import { hintPrice, marginPct, profit } from "./cost";

describe("monthlyAmount", () => {
  it("keeps a monthly amount", () => {
    expect(monthlyAmount({ kind: "monthly", amount: 5000000, months: null })).toBe(5000000);
  });
  it("turns weekly into monthly (x52/12)", () => {
    expect(monthlyAmount({ kind: "weekly", amount: 600000, months: null })).toBe(2600000);
  });
  it("spreads a one-time cost over its months", () => {
    expect(monthlyAmount({ kind: "oneTime", amount: 18000000, months: 24 })).toBe(750000);
  });
  it("rounds half up to the smallest unit", () => {
    expect(monthlyAmount({ kind: "oneTime", amount: 5, months: 2 })).toBe(3);
    expect(monthlyAmount({ kind: "oneTime", amount: 10, months: 3 })).toBe(3);
    expect(monthlyAmount({ kind: "weekly", amount: 1, months: null })).toBe(4);
  });
  it("rounds USD cents", () => {
    expect(monthlyAmount({ kind: "weekly", amount: 1000, months: null })).toBe(4333);
  });
});

describe("fixedTotal", () => {
  it("sums the rounded monthly amounts", () => {
    expect(
      fixedTotal([
        { kind: "monthly", amount: 5000000, months: null },
        { kind: "weekly", amount: 600000, months: null },
        { kind: "oneTime", amount: 18000000, months: 24 },
        { kind: "monthly", amount: 250000, months: null },
      ]),
    ).toBe(8600000);
  });
  it("is 0 for no items", () => {
    expect(fixedTotal([])).toBe(0);
  });
});

describe("perCupShare", () => {
  it("divides the total by cups, rounded", () => {
    expect(perCupShare(8600000, 1500)).toBe(5733);
  });
  it("rounds USD cents", () => {
    expect(perCupShare(100000, 3)).toBe(33333);
  });
  it("is null without usable cups or total", () => {
    expect(perCupShare(8600000, null)).toBeNull();
    expect(perCupShare(8600000, 0)).toBeNull();
    expect(perCupShare(0, 1500)).toBeNull();
  });
});

describe("fullCost", () => {
  it("adds the share to the size cost", () => {
    expect(fullCost(11035, 5733)).toBe(16768);
  });
  it("is the size cost without a share", () => {
    expect(fullCost(11035, null)).toBe(11035);
  });
  it("gives every size the same share", () => {
    expect(fullCost(11035, 5733) - 11035).toBe(fullCost(14000, 5733) - 14000);
  });
  it("feeds profit, margin and hint for Trà sữa M", () => {
    const cost = fullCost(11035, 5733);
    const p = profit(35000, cost);
    expect(p).toBe(18232);
    expect(marginPct(p as number, 35000)).toBe(52);
    expect(hintPrice(cost, 65, "VND")).toBe(48000);
  });
  it("matches #13 results without a share", () => {
    const cost = fullCost(11035, null);
    const p = profit(35000, cost);
    expect(p).toBe(23965);
    expect(marginPct(p as number, 35000)).toBe(68);
    expect(hintPrice(cost, 65, "VND")).toBe(32000);
  });
});

describe("kindMonthsChanges", () => {
  it("sends the months whenever the kind moves to one-time, even when they are unchanged", () => {
    expect(kindMonthsChanges({ kind: "weekly", months: 24 }, "oneTime", 24)).toEqual({ kind: "oneTime", months: 24 });
  });
  it("sends only a changed months for a cost that stays one-time", () => {
    expect(kindMonthsChanges({ kind: "oneTime", months: 24 }, "oneTime", 24)).toEqual({});
    expect(kindMonthsChanges({ kind: "oneTime", months: 24 }, "oneTime", 12)).toEqual({ months: 12 });
  });
  it("sends no months when the kind is not one-time", () => {
    expect(kindMonthsChanges({ kind: "oneTime", months: 24 }, "weekly", null)).toEqual({ kind: "weekly" });
  });
});
