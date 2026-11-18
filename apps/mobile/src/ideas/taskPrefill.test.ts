import { describe, expect, it } from "vitest";

import { ApiError } from "../lib/api";
import type { Label } from "../tasks/types";
import { idea } from "./fixtures";
import { createTaskErrorKey, prefilledTaskForm } from "./taskPrefill";

const labels: Label[] = [
  { id: "a", name: "Đồ uống", colour: "orange" },
  { id: "b", name: "Thử nghiệm", colour: "yellow" },
];

describe("prefilledTaskForm", () => {
  it("takes the title, description and labels of the idea, and names the idea", () => {
    const i = idea({ id: "i1", title: "Trà đào", description: "Ly 700ml", labelIds: ["b", "a"] });
    expect(prefilledTaskForm(i, labels)).toEqual({
      ideaId: "i1",
      ideaTitle: "Trà đào",
      title: "Trà đào",
      description: "Ly 700ml",
      labels: [labels[1], labels[0]],
    });
  });

  it("leaves out a label that is gone", () => {
    const i = idea({ id: "i1", labelIds: ["a", "deleted"] });
    expect(prefilledTaskForm(i, labels).labels).toEqual([labels[0]]);
  });

  it("copes with no description and no labels", () => {
    const form = prefilledTaskForm(idea({ id: "i1", title: "T" }), []);
    expect(form.description).toBe("");
    expect(form.labels).toEqual([]);
  });
});

describe("createTaskErrorKey", () => {
  it("says it needs the network when the server cannot be reached", () => {
    expect(createTaskErrorKey(new ApiError("network"))).toBe("ideas.createTask.needsNetwork");
  });
  it("explains each refusal of the server", () => {
    expect(createTaskErrorKey(new ApiError("idea_not_accepted", 409))).toBe("ideas.createTask.notAccepted");
    expect(createTaskErrorKey(new ApiError("idea_already_has_task", 409))).toBe("ideas.createTask.alreadyHasTask");
    expect(createTaskErrorKey(new ApiError("task_limit_reached", 409))).toBe("ideas.createTask.limit");
    expect(createTaskErrorKey(new ApiError("not_found", 404))).toBe("ideas.createTask.gone");
  });
  it("falls back to the generic message", () => {
    expect(createTaskErrorKey(new ApiError("internal_error", 500))).toBe("errors.generic");
    expect(createTaskErrorKey(new Error("boom"))).toBe("errors.generic");
  });
});
