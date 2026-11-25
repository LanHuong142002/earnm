import { describe, expect, it } from "vitest";

import { afterDelete, afterSave, cupsPerDay, parseCupsText, previewMonthly, validateFixedCostForm } from "./fixedCostForm";

const limits = { nameMax: 80, amountMax: 1_000_000_000, monthsMax: 120 };
const item = (id: string, kind: "monthly" | "weekly" | "oneTime", amount: number, months: number | null = null) => ({ id, kind, amount, months });

describe("validateFixedCostForm", () => {
  const ok = { name: "Máy xay đá", kind: "oneTime" as const, amount: 4_800_000, months: 12 };
  it("accepts a valid one-time cost", () => {
    expect(validateFixedCostForm(ok, [], limits)).toEqual({});
  });
  it("needs an amount above 0", () => {
    expect(validateFixedCostForm({ ...ok, amount: 0 }, [], limits).amount).toBe("amountRequired");
    expect(validateFixedCostForm({ ...ok, amount: null }, [], limits).amount).toBe("amountRequired");
  });
  it("caps the amount", () => {
    expect(validateFixedCostForm({ ...ok, amount: 1_000_000_001 }, [], limits).amount).toBe("amountTooBig");
  });
  it("needs months from 1 to 120 only for one-time", () => {
    expect(validateFixedCostForm({ ...ok, months: 0 }, [], limits).months).toBe("monthsRange");
    expect(validateFixedCostForm({ ...ok, months: null }, [], limits).months).toBe("monthsRange");
    expect(validateFixedCostForm({ ...ok, months: 121 }, [], limits).months).toBe("monthsRange");
    expect(validateFixedCostForm({ ...ok, months: 120 }, [], limits).months).toBeUndefined();
    expect(validateFixedCostForm({ ...ok, kind: "weekly", months: 0 }, [], limits).months).toBeUndefined();
  });
  it("checks the name: empty, too long, duplicate ignoring case", () => {
    expect(validateFixedCostForm({ ...ok, name: "  " }, [], limits).name).toBe("nameEmpty");
    expect(validateFixedCostForm({ ...ok, name: "a".repeat(81) }, [], limits).name).toBe("nameTooLong");
    expect(validateFixedCostForm(ok, ["máy XAY đá"], limits).name).toBe("nameDuplicate");
  });
});

describe("previewMonthly", () => {
  it("is null without a usable amount", () => {
    expect(previewMonthly("monthly", null, null)).toBeNull();
    expect(previewMonthly("monthly", 0, null)).toBeNull();
    expect(previewMonthly("oneTime", 4_800_000, null)).toBeNull();
    expect(previewMonthly("oneTime", 4_800_000, 0)).toBeNull();
  });
  it("converts each kind", () => {
    expect(previewMonthly("oneTime", 4_800_000, 12)).toBe(400_000);
    expect(previewMonthly("weekly", 600_000, null)).toBe(2_600_000);
    expect(previewMonthly("monthly", 250_000, null)).toBe(250_000);
  });
});

describe("afterSave / afterDelete", () => {
  const items = [item("a", "monthly", 5_000_000), item("b", "weekly", 600_000), item("c", "oneTime", 18_000_000, 24), item("d", "monthly", 250_000)];
  it("adds a new item to the total (mockup 1d)", () => {
    const base = [item("a", "monthly", 5_000_000), item("b", "monthly", 3_600_000)];
    expect(afterSave(base, null, { kind: "oneTime", amount: 4_800_000, months: 12 }, 1500)).toEqual({ total: 9_000_000, share: 6000 });
  });
  it("replaces the edited item", () => {
    expect(afterSave(items, "a", { kind: "monthly", amount: 4_000_000, months: null }, 1500).total).toBe(7_600_000);
  });
  it("has no share without cups", () => {
    expect(afterSave(items, null, { kind: "monthly", amount: 1, months: null }, null).share).toBeNull();
  });
  it("names the total and share after a delete (mockup 1g)", () => {
    expect(afterDelete(items, "a", 1500)).toEqual({ total: 3_600_000, share: 2400 });
  });
  it("gives a zero total and no share when the last one goes", () => {
    expect(afterDelete([item("a", "monthly", 5)], "a", 1500)).toEqual({ total: 0, share: null });
  });
});

describe("cups helpers", () => {
  it("parses whole numbers, empty is null, dots are ignored", () => {
    expect(parseCupsText("1.500")).toBe(1500);
    expect(parseCupsText("")).toBeNull();
    expect(parseCupsText("abc")).toBeNull();
  });
  it("is per day over a 30-day month", () => {
    expect(cupsPerDay(1500)).toBe(50);
    expect(cupsPerDay(10)).toBe(0);
    expect(cupsPerDay(1510)).toBe(50);
  });
});
