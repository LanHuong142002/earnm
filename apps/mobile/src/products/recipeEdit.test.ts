import { describe, expect, it } from "vitest";

import { extraCost, productSize } from "./fixtures";
import {
  addExtra,
  addLine,
  extrasToAdd,
  parseAmount,
  recipeOf,
  removeExtra,
  removeLine,
  setExtraAmount,
  setLineAmount,
  toggleExtra,
  toggleLine,
  validMoney,
} from "./recipeEdit";

const size = productSize({
  size: "M",
  lines: [
    { ingredientId: "ly", amount: 1, included: true, isDefault: true },
    { ingredientId: "tra", amount: 6, included: true, isDefault: false },
  ],
  extras: [{ id: "x1", name: "Đá", amount: 600, included: true, isDefault: true, extraCostId: "e1" }],
});

describe("parseAmount", () => {
  it("reads a comma or dot decimal with up to 3 decimals", () => {
    expect(parseAmount("6")).toEqual({ ok: true, value: 6 });
    expect(parseAmount("0,25")).toEqual({ ok: true, value: 0.25 });
    expect(parseAmount("1.125")).toEqual({ ok: true, value: 1.125 });
  });
  it("refuses text, zero, too many decimals and more than 100.000", () => {
    expect(parseAmount("")).toEqual({ ok: false, error: "invalid" });
    expect(parseAmount("abc")).toEqual({ ok: false, error: "invalid" });
    expect(parseAmount("0")).toEqual({ ok: false, error: "zero" });
    expect(parseAmount("1,2345")).toEqual({ ok: false, error: "decimals" });
    expect(parseAmount("100000,001")).toEqual({ ok: false, error: "tooLarge" });
    expect(parseAmount("100000")).toEqual({ ok: true, value: 100000 });
  });
  it("lets a default line stay at 0", () => {
    expect(parseAmount("0", { allowZero: true })).toEqual({ ok: true, value: 0 });
  });
});

describe("validMoney", () => {
  it("wants a whole number from 0 to 1.000.000.000", () => {
    expect(validMoney(0)).toBe(true);
    expect(validMoney(1_000_000_000)).toBe(true);
    expect(validMoney(1_000_000_001)).toBe(false);
    expect(validMoney(-1)).toBe(false);
    expect(validMoney(1.5)).toBe(false);
    expect(validMoney(null)).toBe(false);
  });
});

describe("recipe edits", () => {
  it("recipeOf drops the default flag of a line and keeps the extras", () => {
    const recipe = recipeOf(size);
    expect(recipe.lines).toEqual([
      { ingredientId: "ly", amount: 1, included: true },
      { ingredientId: "tra", amount: 6, included: true },
    ]);
    expect(recipe.extras).toEqual(size.extras);
  });

  it("changes one line's amount, ticks and removes without touching the others", () => {
    const recipe = recipeOf(size);
    expect(setLineAmount(recipe, "tra", 8).lines[1].amount).toBe(8);
    expect(setLineAmount(recipe, "tra", 8).lines[0]).toBe(recipe.lines[0]);
    expect(toggleLine(recipe, "ly").lines[0].included).toBe(false);
    expect(removeLine(recipe, "tra").lines.map((l) => l.ingredientId)).toEqual(["ly"]);
  });

  it("adds a ticked line once per ingredient", () => {
    const recipe = recipeOf(size);
    const added = addLine(recipe, "sua", 80);
    expect(added.lines[2]).toEqual({ ingredientId: "sua", amount: 80, included: true });
    expect(addLine(added, "sua", 5)).toBe(added);
  });

  it("changes, ticks and removes an extra", () => {
    const recipe = recipeOf(size);
    expect(setExtraAmount(recipe, "x1", 700).extras[0].amount).toBe(700);
    expect(toggleExtra(recipe, "x1").extras[0].included).toBe(false);
    expect(removeExtra(recipe, "x1").extras).toEqual([]);
  });

  it("copies a project extra cost into the size once, ticked, with a local id", () => {
    const recipe = recipeOf(size);
    const khan = extraCost({ id: "e2", name: "Khăn", amount: 150 });
    const added = addExtra(recipe, "p1", "M", khan);
    expect(added.extras[1]).toEqual({ id: "local:p1:M:e2", name: "Khăn", amount: 150, included: true, isDefault: false, extraCostId: "e2" });
    expect(addExtra(added, "p1", "M", khan)).toBe(added);
  });

  it("offers only the extra costs the size does not have", () => {
    const list = [extraCost({ id: "e1", name: "Đá" }), extraCost({ id: "e2", name: "Khăn" })];
    expect(extrasToAdd(recipeOf(size), list).map((x) => x.id)).toEqual(["e2"]);
  });
});
