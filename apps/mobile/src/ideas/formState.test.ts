import { describe, expect, it } from "vitest";

import { editFromIdeaForm, emptyIdeaForm, ideaErrorKeys, ideaFormFromIdea, inputFromIdeaForm, toggleIdeaLabel } from "./formState";
import { idea } from "./fixtures";

describe("idea form", () => {
  it("starts empty for a new idea", () => {
    expect(emptyIdeaForm()).toEqual({ title: "", description: "", labelIds: [] });
  });

  it("opens with what the idea has", () => {
    const i = idea({ id: "i1", title: "Trà", description: "Ly lớn", labelIds: ["a", "b"] });
    expect(ideaFormFromIdea(i)).toEqual({ title: "Trà", description: "Ly lớn", labelIds: ["a", "b"] });
  });

  it("turns the form into the input of a new idea", () => {
    expect(inputFromIdeaForm({ title: "T", description: "D", labelIds: ["a"] })).toEqual({ title: "T", description: "D", labelIds: ["a"] });
  });

  it("sends only what changed on edit", () => {
    const opened = { title: "A", description: "B", labelIds: ["x"] };
    expect(editFromIdeaForm(opened, opened)).toEqual({});
    expect(editFromIdeaForm(opened, { ...opened, title: "A2" })).toEqual({ title: "A2" });
    expect(editFromIdeaForm(opened, { ...opened, description: "" })).toEqual({ description: "" });
    expect(editFromIdeaForm(opened, { ...opened, labelIds: ["x", "y"] })).toEqual({ labelIds: ["x", "y"] });
  });

  it("does not call the same labels in another order a change", () => {
    const opened = { title: "A", description: "", labelIds: ["x", "y"] };
    expect(editFromIdeaForm(opened, { ...opened, labelIds: ["y", "x"] })).toEqual({});
  });

  describe("toggleIdeaLabel", () => {
    it("adds and removes a label", () => {
      expect(toggleIdeaLabel(["a"], "b")).toEqual({ ids: ["a", "b"], limit: false });
      expect(toggleIdeaLabel(["a", "b"], "a")).toEqual({ ids: ["b"], limit: false });
    });

    it("refuses an eleventh label", () => {
      const ten = Array.from({ length: 10 }, (_, n) => `l${n}`);
      expect(toggleIdeaLabel(ten, "more")).toEqual({ ids: ten, limit: true });
      expect(toggleIdeaLabel(ten, "l3").ids).toHaveLength(9);
    });
  });

  describe("ideaErrorKeys", () => {
    it("has nothing to say without errors", () => {
      expect(ideaErrorKeys({})).toEqual({ title: undefined, description: undefined, labels: undefined });
    });
    it("names the message of each field", () => {
      expect(ideaErrorKeys({ title: "required" }).title).toBe("ideas.errors.titleRequired");
      expect(ideaErrorKeys({ title: "too_long" }).title).toBe("ideas.errors.titleTooLong");
      expect(ideaErrorKeys({ description: "too_long" }).description).toBe("ideas.errors.descriptionTooLong");
      expect(ideaErrorKeys({ labels: "too_many" }).labels).toBe("ideas.errors.labelsTooMany");
    });
  });
});
