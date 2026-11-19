import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../lib/api";
import type { Change } from "../sync/queue";
import { ingredient } from "./fixtures";
import { createIngredientSyncCycle, ingredientReasonFor, type IngredientRejectedNotice } from "./syncCycle";
import type { Ingredient } from "./types";

const change = (over: Partial<Change> = {}): Change => ({
  changeId: "c1",
  entity: "ingredient",
  entityId: "g1",
  kind: "update",
  data: { projectId: "p1" },
  fieldTimes: {},
  createdAt: "2026-11-18T09:00:00.000Z",
  ...over,
});

type Lists = Record<string, Ingredient[]>;

function setup(initial: Lists = { p1: [ingredient({ id: "g1", name: "Cũ" })] }, listed: Ingredient[] = []) {
  let lists = initial;
  let generation = 0;
  const notices: IngredientRejectedNotice[] = [];
  const deps = {
    getToken: vi.fn(async () => "tok" as string | null),
    listIngredients: vi.fn(async () => listed),
    getIngredients: (projectId: string) => lists[projectId] ?? null,
    commit: async (projectId: string, list: Ingredient[]) => {
      lists = { ...lists, [projectId]: list };
    },
    setNotice: (n: IngredientRejectedNotice) => void notices.push(n),
    getGeneration: () => generation,
    isWiped: () => false,
    onNotSignedIn: vi.fn(),
  };
  const cycle = createIngredientSyncCycle(deps);
  return { cycle, deps, notices, get: () => lists, bump: () => void generation++ };
}

describe("ingredient sync cycle", () => {
  it("replaces the cached ingredient with the server's reply", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change(), ingredient({ id: "g1", name: "Mới" }));
    await s.cycle.idle();
    expect(s.get().p1).toMatchObject([{ id: "g1", name: "Mới" }]);
  });

  it("adds an ingredient the server just created, removes a deleted one", async () => {
    const s = setup();
    s.cycle.handlers.onApplied(change({ kind: "create", entityId: "g2" }), ingredient({ id: "g2" }));
    await s.cycle.idle();
    expect(s.get().p1.map((i) => i.id)).toEqual(["g1", "g2"]);
    s.cycle.handlers.onApplied(change({ kind: "delete", entityId: "g1" }), undefined);
    await s.cycle.idle();
    expect(s.get().p1.map((i) => i.id)).toEqual(["g2"]);
  });

  it("a malformed reply leaves the cache alone and fetches the project again", async () => {
    const s = setup(undefined, [ingredient({ id: "g1", name: "Từ máy chủ" })]);
    s.cycle.handlers.onApplied(change(), { nonsense: true });
    await s.cycle.idle();
    expect(s.get().p1[0].name).toBe("Cũ");
    await s.cycle.refreshPending();
    expect(s.get().p1[0].name).toBe("Từ máy chủ");
  });

  it("a reply for a project that was never fetched does not make a one-item list", async () => {
    const s = setup({});
    s.cycle.handlers.onApplied(change({ kind: "create" }), ingredient({ id: "g1" }));
    await s.cycle.idle();
    expect(s.get().p1).toBeUndefined();
  });

  it("a refused change sets the notice with the name and fetches the project again", async () => {
    const s = setup(undefined, [ingredient({ id: "g1", name: "Từ máy chủ" })]);
    s.cycle.handlers.onRejected(change(), new ApiError("ingredient_name_taken", 409));
    await s.cycle.idle();
    expect(s.notices).toEqual([{ kind: "update", ingredientName: "Cũ", reason: "nameTaken" }]);
    await s.cycle.refreshPending();
    expect(s.deps.listIngredients).toHaveBeenCalledTimes(1);
  });

  it("a refused create names the ingredient from the change", async () => {
    const s = setup();
    s.cycle.handlers.onRejected(
      change({ kind: "create", entityId: "g9", data: { projectId: "p1", name: "Mới" } }),
      new ApiError("ingredient_limit_reached", 409),
    );
    await s.cycle.idle();
    expect(s.notices).toEqual([{ kind: "create", ingredientName: "Mới", reason: "limit" }]);
  });

  it("refresh saves the server's list, tells offline from an error, empties a gone project", async () => {
    const s = setup(undefined, [ingredient({ id: "a" }), ingredient({ id: "b" })]);
    expect(await s.cycle.refresh("p1")).toBe("ok");
    expect(s.get().p1.map((i) => i.id)).toEqual(["a", "b"]);
    s.deps.getToken.mockResolvedValueOnce(null);
    expect(await s.cycle.refresh("p1")).toBe("skipped");
    s.deps.listIngredients.mockRejectedValueOnce(new ApiError("network"));
    expect(await s.cycle.refresh("p1")).toBe("offline");
    s.deps.listIngredients.mockRejectedValueOnce(new ApiError("server_error", 500));
    expect(await s.cycle.refresh("p1")).toBe("error");
    expect(s.get().p1).toHaveLength(2);
    s.deps.listIngredients.mockRejectedValueOnce(new ApiError("not_found", 404));
    expect(await s.cycle.refresh("p1")).toBe("gone");
    expect(s.get().p1).toEqual([]);
    s.deps.listIngredients.mockRejectedValueOnce(new ApiError("not_signed_in", 401));
    expect(await s.cycle.refresh("p1")).toBe("skipped");
    expect(s.deps.onNotSignedIn).toHaveBeenCalled();
  });

  it("drops a refresh that finishes after the session changed", async () => {
    const s = setup(undefined, []);
    s.deps.listIngredients.mockImplementationOnce(async () => {
      s.bump();
      return [];
    });
    expect(await s.cycle.refresh("p1")).toBe("skipped");
    expect(s.get().p1).toHaveLength(1);
  });
});

describe("ingredientReasonFor", () => {
  it("reads the name and the limit, and falls back to the task reasons", () => {
    expect(ingredientReasonFor(new ApiError("ingredient_name_taken", 409))).toBe("nameTaken");
    expect(ingredientReasonFor(new ApiError("ingredient_limit_reached", 409))).toBe("limit");
    expect(ingredientReasonFor(new ApiError("id_conflict", 409))).toBe("conflict");
    expect(ingredientReasonFor(new ApiError("ingredient_mode_conflict", 409))).toBe("conflict");
    expect(ingredientReasonFor(new ApiError("validation_failed", 400))).toBe("invalid");
    expect(ingredientReasonFor(new ApiError("forbidden", 403))).toBe("forbidden");
  });

  it("a delete refused because products use the ingredient carries the product names", async () => {
    const s = setup();
    const error = new ApiError("ingredient_in_use", 409, "used", { products: ["Trà sữa", "Cà phê", 3] });
    s.cycle.handlers.onRejected(change({ kind: "delete" }), error);
    await s.cycle.idle();
    expect(s.notices).toEqual([{ kind: "delete", ingredientName: "Cũ", reason: "inUse", products: ["Trà sữa", "Cà phê"] }]);
    expect(ingredientReasonFor(error)).toBe("inUse");
  });
});
