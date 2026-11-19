import { describe, expect, it } from "vitest";

import { newIdeaCount } from "./counts";
import { DEFAULT_IDEA_FILTERS, filterIdeas } from "./filters";
import { idea } from "./fixtures";
import { orderIdeas } from "./order";
import { canEditIdea } from "./permissions";
import { createTaskState, ideaAuthorName } from "./view";

describe("orderIdeas (spec AC17)", () => {
  it("puts the highest score first, then the newest", () => {
    const list = [
      idea({ id: "old-high", score: 5, createdAt: "2026-11-01T00:00:00.000Z" }),
      idea({ id: "new-low", score: 1, createdAt: "2026-11-09T00:00:00.000Z" }),
      idea({ id: "new-high", score: 5, createdAt: "2026-11-08T00:00:00.000Z" }),
      idea({ id: "negative", score: -2, createdAt: "2026-11-09T12:00:00.000Z" }),
      idea({ id: "old-low", score: 1, createdAt: "2026-11-02T00:00:00.000Z" }),
    ];
    expect(orderIdeas(list).open.map((i) => i.id)).toEqual(["new-high", "old-high", "new-low", "old-low", "negative"]);
  });

  it("keeps dropped ideas apart, in the same order", () => {
    const list = [
      idea({ id: "a", score: 9, status: "dropped" }),
      idea({ id: "b", score: 1 }),
      idea({ id: "c", score: 3, status: "dropped" }),
    ];
    const { open, dropped } = orderIdeas(list);
    expect(open.map((i) => i.id)).toEqual(["b"]);
    expect(dropped.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("does not change the list it is given", () => {
    const list = [idea({ id: "a", score: 1 }), idea({ id: "b", score: 2 })];
    orderIdeas(list);
    expect(list.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("is stable for equal scores and times", () => {
    const list = [idea({ id: "b" }), idea({ id: "a" })];
    expect(orderIdeas(list).open.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("filterIdeas (spec AC17)", () => {
  const list = [
    idea({ id: "n", status: "new", labelIds: ["l1"] }),
    idea({ id: "c", status: "considering", labelIds: ["l2"] }),
    idea({ id: "a", status: "accepted", labelIds: ["l1", "l2"] }),
    idea({ id: "d", status: "dropped", labelIds: ["l1"] }),
  ];
  const labels = [{ id: "l1" }, { id: "l2" }];

  it("keeps everything, dropped ideas included, with no filter", () => {
    expect(filterIdeas(list, DEFAULT_IDEA_FILTERS, labels).map((i) => i.id)).toEqual(["n", "c", "a", "d"]);
  });

  it("keeps only the chosen status", () => {
    expect(filterIdeas(list, { status: "considering", labelIds: [] }, labels).map((i) => i.id)).toEqual(["c"]);
    expect(filterIdeas(list, { status: "accepted", labelIds: [] }, labels).map((i) => i.id)).toEqual(["a"]);
  });

  it("keeps ideas with any chosen label", () => {
    expect(filterIdeas(list, { status: "all", labelIds: ["l2"] }, labels).map((i) => i.id)).toEqual(["c", "a"]);
    expect(filterIdeas(list, { status: "all", labelIds: ["l1", "l2"] }, labels).map((i) => i.id)).toEqual(["n", "c", "a", "d"]);
  });

  it("needs both the status and the label", () => {
    expect(filterIdeas(list, { status: "accepted", labelIds: ["l1"] }, labels).map((i) => i.id)).toEqual(["a"]);
    expect(filterIdeas(list, { status: "new", labelIds: ["l2"] }, labels)).toEqual([]);
  });

  it("ignores a chosen label that no longer exists", () => {
    expect(filterIdeas(list, { status: "all", labelIds: ["gone"] }, labels)).toHaveLength(4);
    expect(filterIdeas(list, { status: "all", labelIds: ["gone", "l2"] }, labels).map((i) => i.id)).toEqual(["c", "a"]);
  });
});

describe("newIdeaCount (spec AC16)", () => {
  it("counts only New ideas", () => {
    const list = [idea({ id: "1" }), idea({ id: "2", status: "considering" }), idea({ id: "3" }), idea({ id: "4", status: "dropped" })];
    expect(newIdeaCount(list)).toBe(2);
    expect(newIdeaCount([])).toBe(0);
  });
});

describe("ideaAuthorName (spec AC6)", () => {
  it("shows the author's name", () => {
    expect(ideaAuthorName(idea({ id: "1" }), "Người dùng cũ")).toBe("An");
  });

  it("falls back to the neutral name once the account is gone", () => {
    expect(ideaAuthorName(idea({ id: "1", author: null }), "Người dùng cũ")).toBe("Người dùng cũ");
  });
});

describe("createTaskState (spec AC12, AC15)", () => {
  it("is hidden until the idea is accepted", () => {
    for (const status of ["new", "considering", "dropped"] as const) {
      expect(createTaskState({ status, taskId: null }, true)).toBe("hidden");
      expect(createTaskState({ status, taskId: null }, false)).toBe("hidden");
    }
  });

  it("is available for an accepted idea when online", () => {
    expect(createTaskState({ status: "accepted", taskId: null }, true)).toBe("available");
  });

  it("needs a network for an accepted idea when offline", () => {
    expect(createTaskState({ status: "accepted", taskId: null }, false)).toBe("needs_network");
  });

  it("shows the created task once there is one, whatever the status or the network", () => {
    expect(createTaskState({ status: "accepted", taskId: "t1" }, false)).toBe("created");
    expect(createTaskState({ status: "considering", taskId: "t1" }, true)).toBe("created");
  });
});

describe("canEditIdea (spec R2)", () => {
  it("lets the author and an Owner edit", () => {
    expect(canEditIdea(idea({ id: "1" }), "u1", "member")).toBe(true);
    expect(canEditIdea(idea({ id: "1" }), "u2", "owner")).toBe(true);
  });

  it("keeps other members out", () => {
    expect(canEditIdea(idea({ id: "1" }), "u2", "member")).toBe(false);
  });

  it("leaves an idea whose author is gone to the Owners", () => {
    expect(canEditIdea(idea({ id: "1", author: null }), "u1", "member")).toBe(false);
    expect(canEditIdea(idea({ id: "1", author: null }), "u1", "owner")).toBe(true);
  });
});
