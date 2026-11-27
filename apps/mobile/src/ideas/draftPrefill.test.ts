import { describe, expect, it } from "vitest";

import { ApiError } from "../lib/api";
import { idea } from "./fixtures";
import { createDraftErrorKey, draftNameFromTitle, ideaDraftBlock, prefilledDraftForm } from "./draftPrefill";

describe("draftNameFromTitle", () => {
  it("keeps a short title as it is", () => {
    expect(draftNameFromTitle("Trà đào")).toBe("Trà đào");
  });

  it("trims spaces", () => {
    expect(draftNameFromTitle("  Trà đào  ")).toBe("Trà đào");
  });

  it("keeps exactly 60 characters", () => {
    const s = "a".repeat(60);
    expect(draftNameFromTitle(s)).toBe(s);
  });

  it("cuts a long title at a word boundary", () => {
    const title = "Thêm món trà trái cây mùa hè cho các quán ở khu vực trung tâm thành phố";
    const name = draftNameFromTitle(title);
    expect(name.length).toBeLessThanOrEqual(60);
    expect(title.startsWith(name)).toBe(true);
    expect(title[name.length]).toBe(" ");
  });

  it("cuts mid-word when the first word alone is longer than 60", () => {
    expect(draftNameFromTitle("a".repeat(80))).toBe("a".repeat(60));
  });

  it("counts a character, not a code unit", () => {
    expect([...draftNameFromTitle("😀".repeat(70))]).toHaveLength(60);
  });
});

describe("prefilledDraftForm", () => {
  it("takes name, note and photo count from the idea and names the idea", () => {
    const i = idea({ id: "i1", title: "Trà đào", description: "Ly 700ml", photoCount: 2 });
    expect(prefilledDraftForm(i)).toEqual({ ideaId: "i1", ideaTitle: "Trà đào", name: "Trà đào", note: "Ly 700ml", photoCount: 2 });
  });

  it("cuts a note that is longer than a draft note allows", () => {
    const i = idea({ id: "i1", description: "x".repeat(900) });
    expect(prefilledDraftForm(i).note).toHaveLength(500);
  });
});

describe("ideaDraftBlock", () => {
  it("allows an accepted idea without a draft", () => {
    expect(ideaDraftBlock(idea({ id: "i", status: "accepted" }))).toBeNull();
  });
  it("blocks an idea that is not accepted", () => {
    expect(ideaDraftBlock(idea({ id: "i", status: "new" }))).toBe("ideas.createDraft.notAccepted");
  });
  it("blocks an idea that has a draft", () => {
    const d = { id: "d1", name: "N", status: "working" as const, convertedAt: null };
    expect(ideaDraftBlock(idea({ id: "i", status: "accepted", draftId: "d1", draft: d }))).toBe("ideas.createDraft.alreadyHasDraft");
  });
});

describe("createDraftErrorKey", () => {
  it.each([
    ["network", "ideas.createDraft.needsNetwork"],
    ["idea_not_accepted", "ideas.createDraft.notAccepted"],
    ["idea_already_has_draft", "ideas.createDraft.alreadyHasDraft"],
    ["draft_limit_reached", "ideas.createDraft.limit"],
    ["id_conflict", "ideas.createDraft.conflict"],
    ["not_found", "ideas.createDraft.gone"],
    ["something_else", "errors.generic"],
  ])("maps %s", (code, key) => {
    expect(createDraftErrorKey(new ApiError(code, 409))).toBe(key);
  });

  it("falls back for a plain error", () => {
    expect(createDraftErrorKey(new Error("x"))).toBe("errors.generic");
  });
});
