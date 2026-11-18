import { describe, expect, it } from "vitest";

import type { Change } from "../../sync/queue";
import { applyCommentOverlay, staleFailedIds } from "./overlay";
import type { ServerComment } from "./types";

const server = (id: string, over: Partial<ServerComment> = {}): ServerComment => ({
  id,
  taskId: "t1",
  author: { id: "u1", displayName: "Lan" },
  text: `text ${id}`,
  edited: false,
  remindWith: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  ...over,
});

let n = 0;
const change = (kind: Change["kind"], entityId: string, data: Record<string, unknown>, fieldTimes: Record<string, string> = {}): Change => ({
  changeId: `ch${++n}`,
  entity: "comment",
  entityId,
  kind,
  data: { projectId: "p1", taskId: "t1", ...data },
  fieldTimes,
  createdAt: "2026-11-02T00:00:00.000Z",
});

describe("applyCommentOverlay", () => {
  it("shows server comments as synced", () => {
    const out = applyCommentOverlay("t1", [server("a")], [], []);
    expect(out).toEqual([{ ...server("a"), state: "synced" }]);
  });

  it("a queued create shows as a waiting comment by the person who wrote it", () => {
    const out = applyCommentOverlay("t1", [], [change("create", "n1", { text: "hi", remindWith: true, authorId: "me", authorName: "Mai" })], []);
    expect(out).toEqual([
      { id: "n1", taskId: "t1", author: { id: "me", displayName: "Mai" }, text: "hi", edited: false, remindWith: true, createdAt: "2026-11-02T00:00:00.000Z", state: "waiting" },
    ]);
  });

  it("a queued text edit shows the new text, marks it edited and waiting; the flag stays", () => {
    const out = applyCommentOverlay("t1", [server("a", { remindWith: true })], [change("update", "a", { text: "new" })], []);
    expect(out[0]).toMatchObject({ text: "new", edited: true, remindWith: true, state: "waiting" });
  });

  it("a queued flag change alone does not mark the comment edited", () => {
    const out = applyCommentOverlay("t1", [server("a")], [change("update", "a", { remindWith: true })], []);
    expect(out[0]).toMatchObject({ remindWith: true, edited: false, text: "text a", state: "waiting" });
  });

  it("a queued delete hides the comment", () => {
    const out = applyCommentOverlay("t1", [server("a"), server("b")], [change("delete", "a", {})], []);
    expect(out.map((c) => c.id)).toEqual(["b"]);
  });

  it("an edit for a comment that is not there is ignored", () => {
    expect(applyCommentOverlay("t1", [], [change("update", "ghost", { text: "x" })], [])).toEqual([]);
  });

  it("a create the server already has is not added twice", () => {
    const out = applyCommentOverlay("t1", [server("a")], [change("create", "a", { text: "dup", authorId: "me", authorName: "Mai" })], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ text: "text a", state: "synced" });
  });

  it("ignores changes of other tasks and other entities", () => {
    const other = { ...change("create", "z", { text: "x" }), data: { projectId: "p1", taskId: "t2", text: "x" } };
    const notComment = { ...change("update", "a", { text: "x" }), entity: "task" };
    expect(applyCommentOverlay("t1", [server("a")], [other, notComment], [])).toHaveLength(1);
  });

  it("a failed create shows as a failed comment", () => {
    const out = applyCommentOverlay("t1", [], [], [change("create", "n1", { text: "hi", authorId: "me", authorName: "Mai" })]);
    expect(out[0]).toMatchObject({ id: "n1", text: "hi", state: "failed" });
  });

  it("a failed edit keeps the new text and shows failed; a failed delete keeps the comment, failed", () => {
    const edited = applyCommentOverlay("t1", [server("a")], [], [change("update", "a", { text: "new" })]);
    expect(edited[0]).toMatchObject({ text: "new", state: "failed" });
    const deleted = applyCommentOverlay("t1", [server("a")], [], [change("delete", "a", {})]);
    expect(deleted[0]).toMatchObject({ id: "a", text: "text a", state: "failed" });
  });

  it("failed wins over waiting for the same comment", () => {
    const out = applyCommentOverlay("t1", [server("a")], [change("update", "a", { remindWith: true })], [change("update", "a", { text: "new" })]);
    expect(out[0]).toMatchObject({ text: "new", remindWith: true, state: "failed" });
  });

  it("a waiting delete hides a comment whose edit failed", () => {
    const out = applyCommentOverlay("t1", [server("a")], [change("delete", "a", {})], [change("update", "a", { text: "new" })]);
    expect(out).toEqual([]);
  });
});

describe("staleFailedIds", () => {
  it("lists failed edits and deletes of a comment the server no longer has, not failed creates", () => {
    const failed = [
      change("update", "gone", { text: "x" }),
      change("delete", "gone", {}),
      change("create", "new", { text: "y" }),
      change("update", "here", { text: "z" }),
    ];
    const ids = staleFailedIds("t1", [server("here")], failed);
    expect(ids).toEqual([failed[0]!.changeId, failed[1]!.changeId]);
  });
  it("keeps a failed edit of a comment whose failed create is still listed", () => {
    const failed = [change("create", "n1", { text: "y" }), change("update", "n1", { text: "z" })];
    expect(staleFailedIds("t1", [], failed)).toEqual([]);
  });
});
