import { describe, expect, it } from "vitest";

import { commentMenu } from "./commentMenu";

const t = (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key);

describe("commentMenu", () => {
  it("is titled with the author and offers an idea, a draft and cancel", () => {
    const menu = commentMenu({ editing: false, name: "Minh", t });
    expect(menu).not.toBeNull();
    expect(menu!.title).toBe('tasks.comments.menuTitle:{"name":"Minh"}');
    expect(menu!.items.map((i) => i.kind)).toEqual(["idea", "draft"]);
    expect(menu!.items.map((i) => i.label)).toEqual(["tasks.comments.addAsIdea", "tasks.comments.addAsDraft"]);
    expect(menu!.cancelLabel).toBe("tasks.comments.cancel");
  });

  it("has an accessibility action for each item, named by its kind", () => {
    const menu = commentMenu({ editing: false, name: "Minh", t })!;
    expect(menu.accessibilityActions).toEqual([
      { name: "addAsIdea", label: "tasks.comments.addAsIdea" },
      { name: "addAsDraft", label: "tasks.comments.addAsDraft" },
    ]);
  });

  it("is absent while the comment is being edited", () => {
    expect(commentMenu({ editing: true, name: "Minh", t })).toBeNull();
  });
});

describe("addAsKind", () => {
  it("maps an accessibility action name back to a kind", async () => {
    const { addAsKind } = await import("./commentMenu");
    expect(addAsKind("addAsIdea")).toBe("idea");
    expect(addAsKind("addAsDraft")).toBe("draft");
    expect(addAsKind("activate")).toBeNull();
  });
});
