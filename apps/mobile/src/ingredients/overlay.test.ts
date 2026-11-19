import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import { ingredient } from "./fixtures";
import { applyIngredientOverlay, pendingIngredientIds } from "./overlay";

const P2 = { quantity: 500, unit: "g", price: 14000 } as const;

const change = (over: Partial<Change>): Change => ({
  changeId: "c",
  entity: "ingredient",
  entityId: "g1",
  kind: "update",
  data: { projectId: "p1" },
  fieldTimes: {},
  createdAt: "2026-11-18T09:00:00.000Z",
  ...over,
});

describe("applyIngredientOverlay", () => {
  const server = [ingredient({ id: "g1", name: "A" }), ingredient({ id: "g2", name: "B" })];

  it("lays a waiting edit over the server's ingredient, field by field", () => {
    const out = applyIngredientOverlay("p1", server, [change({ data: { projectId: "p1", name: "A2", purchase: P2 } })]);
    expect(out[0]).toMatchObject({ name: "A2", purchase: P2, mode: "weight" });
    expect(out[1].name).toBe("B");
  });

  it("shows a waiting create, hides a waiting delete, ignores other projects and unknown ids", () => {
    const create = change({
      kind: "create",
      entityId: "g3",
      data: { projectId: "p1", name: "C", mode: "volume", purchase: { quantity: 1000, unit: "l", price: 9000 }, isDefault: true, authorId: "u1", authorName: "An" },
    });
    const del = change({ kind: "delete", entityId: "g2" });
    const other = change({ entityId: "g1", data: { projectId: "p9", name: "X" } });
    const unknown = change({ entityId: "zz", data: { projectId: "p1", name: "Y" } });
    const out = applyIngredientOverlay("p1", server, [create, del, other, unknown]);
    expect(out.map((i) => i.id)).toEqual(["g1", "g3"]);
    expect(out[1]).toMatchObject({ name: "C", mode: "volume", isDefault: true, purchase: { unit: "l" } });
  });
});

describe("pendingIngredientIds", () => {
  it("lists the ingredients of the project with a waiting change", () => {
    const ids = pendingIngredientIds("p1", [change({ entityId: "g1" }), change({ entityId: "g2", data: { projectId: "p9" } }), change({ entity: "idea", entityId: "g3" })]);
    expect([...ids]).toEqual(["g1"]);
  });
});
