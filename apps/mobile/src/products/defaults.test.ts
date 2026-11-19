import { describe, expect, it } from "vitest";

import { ingredient } from "../ingredients/fixtures";
import { buildDefaults, localExtraId } from "./defaults";
import { extraCost } from "./fixtures";

describe("buildDefaults (local default lines, matching the server)", () => {
  const ingredients = [
    ingredient({ id: "g2", mode: "weight", isDefault: true, createdAt: "2026-11-10T10:00:00.000Z" }),
    ingredient({ id: "g1", mode: "portion", isDefault: true, createdAt: "2026-11-10T09:00:00.000Z" }),
    ingredient({ id: "g3", mode: "volume", isDefault: false }),
  ];
  const extras = [extraCost({ id: "x1", name: "Đá", amount: 500, isDefault: true }), extraCost({ id: "x2", isDefault: false })];

  it("makes a ticked line per default ingredient, one portion for portions and 0 otherwise, oldest first", () => {
    expect(buildDefaults("pr1", "M", ingredients, extras).lines).toEqual([
      { ingredientId: "g1", amount: 1, included: true, isDefault: true },
      { ingredientId: "g2", amount: 0, included: true, isDefault: true },
    ]);
  });

  it("copies each default extra cost, ticked, linked to the extra cost it came from", () => {
    expect(buildDefaults("pr1", "M", ingredients, extras).extras).toEqual([
      { id: localExtraId("pr1", "M", "x1"), name: "Đá", amount: 500, included: true, isDefault: true, extraCostId: "x1" },
    ]);
  });

  it("gives a non-uuid local id, so it is never sent to the server as one", () => {
    expect(localExtraId("pr1", "M", "x1")).toMatch(/^local:/);
  });
});
