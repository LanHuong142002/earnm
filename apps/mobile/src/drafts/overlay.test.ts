import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import { draft, draftLine } from "./fixtures";
import { applyDraftOverlay, pendingDraftIds } from "./overlay";

let n = 0;
const change = (over: Partial<Change> & Pick<Change, "entity" | "entityId" | "kind">): Change => ({
  changeId: `c${n++}`,
  data: { projectId: "p1" },
  fieldTimes: {},
  createdAt: "2026-11-18T09:00:00.000Z",
  ...over,
});

describe("draft overlay", () => {
  it("shows a waiting create as a working draft with no lines", () => {
    const shown = applyDraftOverlay("p1", [], [
      change({ entity: "draft", entityId: "d1", kind: "create", data: { projectId: "p1", name: "Trà", sizes: ["L", "S"], expectedPrice: 45000, note: "ghi chú" } }),
    ]);
    expect(shown).toMatchObject([{ id: "d1", name: "Trà", sizes: ["S", "L"], expectedPrice: 45000, note: "ghi chú", status: "working", productId: null, lines: [] }]);
  });

  it("lays an edit over the server's draft, field by field, leaving other drafts and projects alone", () => {
    const server = [draft({ id: "d1", name: "Cũ", note: "n" }), draft({ id: "d2", name: "Khác" })];
    const shown = applyDraftOverlay("p1", server, [
      change({ entity: "draft", entityId: "d1", kind: "update", data: { projectId: "p1", name: "Mới", expectedPrice: null } }),
      change({ entity: "draft", entityId: "d2", kind: "update", data: { projectId: "p2", name: "Project khác" } }),
    ]);
    expect(shown[0]).toMatchObject({ name: "Mới", note: "n", expectedPrice: null });
    expect(shown[1].name).toBe("Khác");
  });

  it("hides a deleted draft and ignores changes for a draft that is not there", () => {
    const server = [draft({ id: "d1" })];
    const shown = applyDraftOverlay("p1", server, [
      change({ entity: "draftStatus", entityId: "ghost", kind: "update", data: { projectId: "p1", value: "done" } }),
      change({ entity: "draft", entityId: "d1", kind: "delete" }),
    ]);
    expect(shown).toEqual([]);
  });

  it("shows a status change", () => {
    const shown = applyDraftOverlay("p1", [draft({ id: "d1" })], [change({ entity: "draftStatus", entityId: "d1", kind: "update", data: { projectId: "p1", value: "done" } })]);
    expect(shown[0].status).toBe("done");
  });

  it("adds, edits and removes lines, in the order they were made", () => {
    const server = [draft({ id: "d1", lines: [draftLine({ id: "l1", amount: 5 }), draftLine({ id: "l2", ingredientId: "g2", amount: 7 })] })];
    const shown = applyDraftOverlay("p1", server, [
      change({ entity: "draftLine", entityId: "l1", kind: "update", data: { projectId: "p1", draftId: "d1", amount: 9 } }),
      change({ entity: "draftLine", entityId: "l2", kind: "delete", data: { projectId: "p1", draftId: "d1" } }),
      change({
        entity: "draftLine",
        entityId: "l3",
        kind: "create",
        data: { projectId: "p1", draftId: "d1", kind: "new", newName: "Vải", newKind: "weight", purchaseQty: 565, purchasePrice: null, amount: 60 },
      }),
      change({ entity: "draftLine", entityId: "l3", kind: "update", data: { projectId: "p1", draftId: "d1", purchasePrice: 45000 } }),
    ]);
    expect(shown[0].lines).toMatchObject([
      { id: "l1", amount: 9 },
      { id: "l3", kind: "new", ingredientId: null, newName: "Vải", newKind: "weight", purchaseQty: 565, purchasePrice: 45000, amount: 60 },
    ]);
  });

  it("shows lines of a waiting create on the waiting draft", () => {
    const shown = applyDraftOverlay("p1", [], [
      change({ entity: "draft", entityId: "d1", kind: "create", data: { projectId: "p1", name: "A", sizes: ["M"], expectedPrice: null, note: "" } }),
      change({ entity: "draftLine", entityId: "l1", kind: "create", data: { projectId: "p1", draftId: "d1", kind: "existing", ingredientId: "g1", amount: 5 } }),
    ]);
    expect(shown[0].lines).toMatchObject([{ id: "l1", kind: "existing", ingredientId: "g1", amount: 5 }]);
  });

  it("lists the drafts with a waiting change, a line or status change included", () => {
    const pending = pendingDraftIds("p1", [
      change({ entity: "draftLine", entityId: "l1", kind: "update", data: { projectId: "p1", draftId: "d1", amount: 1 } }),
      change({ entity: "draftStatus", entityId: "d2", kind: "update", data: { projectId: "p1", value: "done" } }),
      change({ entity: "draft", entityId: "d3", kind: "update", data: { projectId: "p2", name: "x" } }),
    ]);
    expect([...pending].sort()).toEqual(["d1", "d2"]);
  });
});
