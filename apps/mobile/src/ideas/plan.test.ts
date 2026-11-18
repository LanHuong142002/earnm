import { describe, expect, it } from "vitest";

import { idea } from "./fixtures";
import { IDEA_ENTITY, IDEA_LABELS_ENTITY, IDEA_VOTE_ENTITY } from "./entities";
import { planIdeaCreate, planIdeaDelete, planIdeaUpdate, planVote, validateIdeaInput } from "./plan";

const NOW = new Date("2026-11-18T09:00:00.000Z");
const me = { id: "u1", displayName: "An" };

describe("validateIdeaInput", () => {
  it("cleans the text and refuses an empty or long title", () => {
    expect(validateIdeaInput({ title: "  Ý tưởng \u0007 ", description: " mô tả ", labelIds: ["a", "a"] }).value).toEqual({
      title: "Ý tưởng",
      description: "mô tả",
      labelIds: ["a"],
    });
    expect(validateIdeaInput({ title: "   ", description: "", labelIds: [] }).errors.title).toBe("required");
    expect(validateIdeaInput({ title: "x".repeat(121), description: "", labelIds: [] }).errors.title).toBe("too_long");
    expect(validateIdeaInput({ title: "x".repeat(120), description: "", labelIds: [] }).errors).toEqual({});
  });

  it("limits the description and the labels", () => {
    expect(validateIdeaInput({ title: "a", description: "x".repeat(2001), labelIds: [] }).errors.description).toBe("too_long");
    expect(validateIdeaInput({ title: "a", description: "", labelIds: Array.from({ length: 11 }, (_, i) => `l${i}`) }).errors.labels).toBe("too_many");
  });
});

describe("planIdeaCreate", () => {
  it("is one create when there are no labels", () => {
    const plan = planIdeaCreate({ id: "i1", projectId: "p1", input: { title: "Ý", description: "", labelIds: [] }, author: me, now: NOW });
    expect(plan.ok && plan.changes.map((c) => c.entity)).toEqual([IDEA_ENTITY]);
  });

  it("sends the labels as their own change after the create (they may name a label that is not sent yet)", () => {
    const plan = planIdeaCreate({ id: "i1", projectId: "p1", input: { title: "Ý", description: "", labelIds: ["l1", "l2"] }, author: me, now: NOW });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes.map((c) => c.entity)).toEqual([IDEA_ENTITY, IDEA_LABELS_ENTITY]);
    expect(plan.changes[0].data).not.toHaveProperty("labels");
    expect(plan.changes[1]).toMatchObject({ entityId: "i1", kind: "update", data: { projectId: "p1", labels: ["l1", "l2"] } });
  });

  it("refuses a bad idea without any change", () => {
    const plan = planIdeaCreate({ id: "i1", projectId: "p1", input: { title: " ", description: "", labelIds: [] }, author: me, now: NOW });
    expect(plan).toEqual({ ok: false, errors: { title: "required" } });
  });
});

describe("planIdeaUpdate", () => {
  const current = idea({ id: "i1", title: "Cũ", description: "Mô tả", status: "new", labelIds: ["a", "b"] });

  it("has no change when nothing differs", () => {
    expect(planIdeaUpdate(current, { title: "Cũ", description: "Mô tả", status: "new", labelIds: ["b", "a"] }, NOW)).toEqual({ ok: true, changes: [] });
  });

  it("queues only the fields that differ, each in the one update", () => {
    const plan = planIdeaUpdate(current, { title: "Mới", description: "Mô tả", status: "accepted" }, NOW);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]).toMatchObject({ entity: IDEA_ENTITY, kind: "update", data: { projectId: "p1", title: "Mới", status: "accepted" } });
    expect(plan.changes[0].data).not.toHaveProperty("description");
    expect(Object.keys(plan.changes[0].fieldTimes ?? {}).sort()).toEqual(["status", "title"]);
  });

  it("returns the label set as its own change next to the field update", () => {
    const plan = planIdeaUpdate(current, { title: "Mới", labelIds: ["c"] }, NOW);
    expect(plan.ok && plan.changes.map((c) => c.entity)).toEqual([IDEA_ENTITY, IDEA_LABELS_ENTITY]);
  });

  it("a status change alone is its own small update, so a member who is not the author can send it", () => {
    const plan = planIdeaUpdate(current, { status: "dropped" }, NOW);
    expect(plan.ok && plan.changes[0].data).toEqual({ projectId: "p1", status: "dropped" });
  });

  it("refuses an empty title and too many labels", () => {
    expect(planIdeaUpdate(current, { title: " " }, NOW)).toEqual({ ok: false, errors: { title: "required" } });
    const many = Array.from({ length: 11 }, (_, i) => `l${i}`);
    expect(planIdeaUpdate(current, { labelIds: many }, NOW)).toEqual({ ok: false, errors: { labels: "too_many" } });
  });
});

describe("planVote and planIdeaDelete", () => {
  it("votes the pressed way, and takes your own vote back", () => {
    expect(planVote({ id: "i1", projectId: "p1", myVote: 0 }, 1, NOW)).toMatchObject({ entity: IDEA_VOTE_ENTITY, entityId: "i1", data: { projectId: "p1", value: 1 } });
    expect(planVote({ id: "i1", projectId: "p1", myVote: 1 }, 1, NOW).data.value).toBe(0);
    expect(planVote({ id: "i1", projectId: "p1", myVote: 1 }, -1, NOW).data.value).toBe(-1);
  });

  it("deletes with the project", () => {
    expect(planIdeaDelete({ id: "i1", projectId: "p1" })).toMatchObject({ entity: IDEA_ENTITY, kind: "delete", entityId: "i1", data: { projectId: "p1" } });
  });
});
