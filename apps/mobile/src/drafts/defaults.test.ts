import { describe, expect, it } from "vitest";

import { withVoteCounts } from "../ideas/voteCounts";
import { idea } from "../ideas/fixtures";
import { withDraftDefaults } from "./defaults";
import { draft } from "./fixtures";

describe("withDraftDefaults", () => {
  it("gives a draft from an older copy no idea and no photos", () => {
    const { ideaId: _a, idea: _b, photoCount: _c, ...old } = draft({ id: "d1" });
    expect(withDraftDefaults(old)).toMatchObject({ ideaId: null, idea: null, photoCount: 0 });
  });

  it("keeps the fields that are present", () => {
    const full = draft({ id: "d1", ideaId: "i1", idea: { id: "i1", title: "Trà đào" }, photoCount: 3 });
    expect(withDraftDefaults(full)).toEqual(full);
  });
});

describe("withVoteCounts draft fields", () => {
  it("gives an idea from an older copy no draft", () => {
    const { draftId: _a, draft: _b, ...old } = idea({ id: "i1" });
    expect(withVoteCounts(old)).toMatchObject({ draftId: null, draft: null });
  });

  it("keeps the draft of an idea that has one", () => {
    const d = { id: "d1", name: "Trà đào", status: "working" as const, convertedAt: null };
    expect(withVoteCounts(idea({ id: "i1", draftId: "d1", draft: d }))).toMatchObject({ draftId: "d1", draft: d });
  });
});
