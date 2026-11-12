import { describe, expect, it } from "vitest";

import { makeTask } from "./fixtures";
import { deriveMembers, showLocalChange } from "./localChange";
import { planTaskCreate, planTaskDelete, planTaskUpdate } from "./optimistic";

const NOW = new Date("2026-11-12T09:00:00.000Z");
const me = { id: "u1", displayName: "Lan" };

describe("deriveMembers", () => {
  it("puts me first, then assignees on cached tasks, then extra members, without repeats", () => {
    const tasks = [
      makeTask({ assignees: [{ id: "u2", displayName: "Huy" }, me] }),
      makeTask({ id: "t2", assignees: [{ id: "u2", displayName: "Huy" }] }),
    ];
    expect(deriveMembers(me, tasks, [{ id: "u3", displayName: "Mai" }, { id: "u2", displayName: "Huy" }])).toEqual([
      me,
      { id: "u2", displayName: "Huy" },
      { id: "u3", displayName: "Mai" },
    ]);
  });

  it("works without a signed-in user", () => {
    expect(deriveMembers(null, [makeTask({ assignees: [me] })], [])).toEqual([me]);
  });

  it("an extra member's name wins over a stale cached one", () => {
    const tasks = [makeTask({ assignees: [{ id: "u2", displayName: "Old" }] })];
    expect(deriveMembers(null, tasks, [{ id: "u2", displayName: "New" }])).toEqual([{ id: "u2", displayName: "New" }]);
  });
});

describe("showLocalChange", () => {
  it("adds a created task with its fields", () => {
    const plan = planTaskCreate({
      id: "n1",
      projectId: "p1",
      userId: "u1",
      members: [me],
      now: NOW,
      input: { title: "Paint", description: "", status: "todo", dueDate: null, dueTime: null, assigneeIds: ["u1"] },
    });
    if (!plan.ok) throw new Error("expected ok");
    const list = showLocalChange([makeTask()], "p1", plan.change, NOW);
    expect(list.map((t) => t.id)).toEqual(["t1", "n1"]);
    expect(list[1]).toMatchObject({ title: "Paint", createdById: "u1", assignees: [me] });
  });

  it("shows an edit on the task and leaves the others", () => {
    const task = makeTask();
    const plan = planTaskUpdate(task, { title: "Sand" }, [], NOW);
    if (!plan.ok || !plan.change) throw new Error("expected a change");
    const list = showLocalChange([task, makeTask({ id: "t2" })], "p1", plan.change, NOW);
    expect(list.map((t) => t.title)).toEqual(["Sand", "Buy paint"]);
  });

  it("removes a deleted task", () => {
    const task = makeTask();
    expect(showLocalChange([task], "p1", planTaskDelete(task), NOW)).toEqual([]);
  });
});
