import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import { buildDefaults } from "./defaults";
import { ingredient } from "../ingredients/fixtures";
import { extraCost, fixedCost, product, productSize } from "./fixtures";
import { applyExtraCostOverlay, applyFixedCostOverlay, applyProductOverlay, pendingExtraCostIds, pendingExpectedCups, pendingFixedCostIds, pendingProductIds } from "./overlay";
import { PROJECT_ENTITY } from "../projects/sync";
import { fixedCostCreateChange, fixedCostDeleteChange, fixedCostUpdateChange, extraCostCreateChange, extraCostDeleteChange, extraCostUpdateChange, productCreateChange, productDeleteChange, productLinesChange, productPriceChange, productUpdateChange } from "./sync";

const NOW = new Date("2026-11-18T09:00:00.000Z");
let n = 0;
const waiting = (...changes: ReturnType<typeof productCreateChange>[]): Change[] =>
  changes.map((c) => ({ ...c, fieldTimes: c.fieldTimes ?? {}, changeId: `c${n++}`, createdAt: NOW.toISOString() }));

const ingredients = [ingredient({ id: "g1", mode: "portion", isDefault: true }), ingredient({ id: "g2", mode: "weight", isDefault: true })];
const extras = [extraCost({ id: "x1", name: "Đá", amount: 500, isDefault: true })];
const defaultsFor = (id: string, size: "S" | "M" | "L") => buildDefaults(id, size, ingredients, extras);

describe("product overlay", () => {
  it("a waiting create shows the product at once with its default lines, offline (spec R13)", () => {
    const list = applyProductOverlay(
      "p1",
      [],
      waiting(productCreateChange({ id: "pr1", projectId: "p1", name: "Trà đào", sizes: ["L", "M"], defaults: { M: defaultsFor("pr1", "M"), L: defaultsFor("pr1", "L") }, now: NOW })),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "pr1", projectId: "p1", name: "Trà đào" });
    // Sizes come in S, M, L order like the server's.
    expect(list[0].sizes.map((s) => s.size)).toEqual(["M", "L"]);
    expect(list[0].sizes[0]).toMatchObject({
      sellingPrice: null,
      lines: [
        { ingredientId: "g1", amount: 1, included: true, isDefault: true },
        { ingredientId: "g2", amount: 0, included: true, isDefault: true },
      ],
      extras: [{ name: "Đá", amount: 500, included: true, isDefault: true, extraCostId: "x1" }],
    });
  });

  it("applies a rename, a price and a recipe laid over the server's product, in order", () => {
    const server = [product({ id: "pr1", name: "Cũ", sizes: [productSize({ size: "M", sellingPrice: 1, lines: [{ ingredientId: "g1", amount: 1, included: true, isDefault: true }] })] })];
    const list = applyProductOverlay(
      "p1",
      server,
      waiting(
        productUpdateChange({ id: "pr1", projectId: "p1", fields: { name: "Mới" }, now: NOW }),
        productPriceChange({ productId: "pr1", projectId: "p1", size: "M", value: 35000, now: NOW }),
        productLinesChange({
          productId: "pr1",
          projectId: "p1",
          size: "M",
          recipe: { lines: [{ ingredientId: "g1", amount: 3, included: false }], extras: [] },
          now: NOW,
        }),
      ),
    );
    expect(list[0].name).toBe("Mới");
    expect(list[0].sizes[0].sellingPrice).toBe(35000);
    // A line keeps its default flag from the server's copy; its amount and tick come from the edit.
    expect(list[0].sizes[0].lines).toEqual([{ ingredientId: "g1", amount: 3, included: false, isDefault: true }]);
  });

  it("clears a price with null", () => {
    const server = [product({ id: "pr1", sizes: [productSize({ size: "M", sellingPrice: 5 })] })];
    const list = applyProductOverlay("p1", server, waiting(productPriceChange({ productId: "pr1", projectId: "p1", size: "M", value: null, now: NOW })));
    expect(list[0].sizes[0].sellingPrice).toBeNull();
  });

  it("adding a size gives it the default lines, removing one drops it", () => {
    const server = [product({ id: "pr1", sizes: [productSize({ size: "M", sellingPrice: 9 }), productSize({ size: "L" })] })];
    const list = applyProductOverlay(
      "p1",
      server,
      waiting(productUpdateChange({ id: "pr1", projectId: "p1", fields: { sizes: ["S", "M"], defaults: { S: defaultsFor("pr1", "S") } }, now: NOW })),
    );
    expect(list[0].sizes.map((s) => s.size)).toEqual(["S", "M"]);
    expect(list[0].sizes[0].lines.map((l) => l.ingredientId)).toEqual(["g1", "g2"]);
    expect(list[0].sizes[1].sellingPrice).toBe(9);
  });

  it("a waiting delete hides the product; changes for a product that is not there are ignored", () => {
    const server = [product({ id: "pr1" }), product({ id: "pr2" })];
    const list = applyProductOverlay(
      "p1",
      server,
      waiting(productDeleteChange({ id: "pr1", projectId: "p1" }), productPriceChange({ productId: "nope", projectId: "p1", size: "M", value: 1, now: NOW })),
    );
    expect(list.map((p) => p.id)).toEqual(["pr2"]);
  });

  it("ignores other projects and other entities", () => {
    const list = applyProductOverlay("p1", [], waiting(productCreateChange({ id: "pr1", projectId: "p2", name: "X", sizes: ["M"], defaults: {}, now: NOW })));
    expect(list).toEqual([]);
  });

  it("a product with a waiting change (its own, a price or a recipe) is pending", () => {
    const w = waiting(
      productPriceChange({ productId: "pr1", projectId: "p1", size: "M", value: 1, now: NOW }),
      productLinesChange({ productId: "pr2", projectId: "p1", size: "S", recipe: { lines: [], extras: [] }, now: NOW }),
      productDeleteChange({ id: "pr3", projectId: "other" }),
    );
    expect([...pendingProductIds("p1", w)].sort()).toEqual(["pr1", "pr2"]);
  });
});

describe("extra cost overlay", () => {
  it("shows a waiting create, edit and delete", () => {
    const server = [extraCost({ id: "x1", name: "Đá" }), extraCost({ id: "x2", name: "Nước" })];
    const w = waiting(
      extraCostCreateChange({ id: "x3", projectId: "p1", name: "Ly", amount: 2000, isDefault: true, now: NOW }),
      extraCostUpdateChange({ id: "x1", projectId: "p1", fields: { amount: 900 }, now: NOW }),
      extraCostDeleteChange({ id: "x2", projectId: "p1" }),
    );
    const list = applyExtraCostOverlay("p1", server, w);
    expect(list.map((x) => x.id)).toEqual(["x1", "x3"]);
    expect(list[0].amount).toBe(900);
    expect(list[1]).toMatchObject({ name: "Ly", amount: 2000, isDefault: true });
    expect([...pendingExtraCostIds("p1", w)].sort()).toEqual(["x1", "x2", "x3"]);
  });
});

describe("fixed cost overlay", () => {
  it("shows a waiting create, edit and delete, and marks them pending", () => {
    const server = [fixedCost({ id: "f1", name: "Thuê" }), fixedCost({ id: "f2", name: "Lương" })];
    const w = waiting(
      fixedCostCreateChange({ id: "f3", projectId: "p1", name: "Máy pha", kind: "oneTime", amount: 18000000, months: 24, now: NOW }),
      fixedCostUpdateChange({ id: "f1", projectId: "p1", fields: { amount: 6000000 }, now: NOW }),
      fixedCostDeleteChange({ id: "f2", projectId: "p1" }),
      fixedCostDeleteChange({ id: "f9", projectId: "other" }),
    );
    const list = applyFixedCostOverlay("p1", server, w);
    expect(list.map((x) => x.id)).toEqual(["f1", "f3"]);
    expect(list[0].amount).toBe(6000000);
    expect(list[1]).toMatchObject({ name: "Máy pha", kind: "oneTime", amount: 18000000, months: 24 });
    expect([...pendingFixedCostIds("p1", w)].sort()).toEqual(["f1", "f2", "f3"]);
  });

  it("switching a cost away from one-time clears its months, switching to one-time sets them", () => {
    const server = [fixedCost({ id: "f1", kind: "oneTime", months: 12 }), fixedCost({ id: "f2", kind: "monthly" })];
    const w = waiting(
      fixedCostUpdateChange({ id: "f1", projectId: "p1", fields: { kind: "weekly" }, now: NOW }),
      fixedCostUpdateChange({ id: "f2", projectId: "p1", fields: { kind: "oneTime", months: 6 }, now: NOW }),
    );
    const list = applyFixedCostOverlay("p1", server, w);
    expect(list[0]).toMatchObject({ kind: "weekly", months: null });
    expect(list[1]).toMatchObject({ kind: "oneTime", months: 6 });
  });

  it("shows a non-one-time cost without months even when no change is waiting", () => {
    const server = [fixedCost({ id: "f1", kind: "weekly", months: 24 }), fixedCost({ id: "f2", kind: "oneTime", months: 6 })];
    const list = applyFixedCostOverlay("p1", server, []);
    expect(list[0]).toMatchObject({ kind: "weekly", months: null });
    expect(list[1]).toMatchObject({ kind: "oneTime", months: 6 });
  });

  it("ignores changes for a cost that is not there", () => {
    const w = waiting(fixedCostUpdateChange({ id: "nope", projectId: "p1", fields: { amount: 1 }, now: NOW }));
    expect(applyFixedCostOverlay("p1", [], w)).toEqual([]);
  });
});

describe("pending expected cups", () => {
  const projectEdit = (entityId: string, data: Record<string, unknown>, kind: "update" | "delete" = "update") => ({
    entity: PROJECT_ENTITY,
    entityId,
    kind,
    data,
    fieldTimes: {},
  });
  it("is pending only while an edit of that project's cups waits", () => {
    const w = waiting(projectEdit("p1", { expectedCupsPerMonth: null }), projectEdit("p2", { name: "X" }));
    expect(pendingExpectedCups("p1", w)).toBe(true);
    expect(pendingExpectedCups("p2", w)).toBe(false);
    expect(pendingExpectedCups("p3", w)).toBe(false);
    expect(pendingExpectedCups("p1", [])).toBe(false);
  });
});
