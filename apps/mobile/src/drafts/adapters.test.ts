import { describe, expect, it } from "vitest";

import { TASK_PHOTOS } from "../tasks/parent";
import { IDEA_PHOTOS } from "../ideas/adapters";
import { DRAFT_PHOTOS, draftParent } from "./adapters";

const open = { convertedAt: null };
const converted = { convertedAt: "2026-11-20T00:00:00.000Z" };
const by = (id: string | null) => ({ addedBy: id === null ? null : { id } });

describe("draftParent", () => {
  it("is a draft with its own photo cache and queue entities", () => {
    const p = draftParent("p1", "d1", open, "u1", "member");
    expect(p).toMatchObject({ kind: "draft", projectId: "p1", id: "d1" });
    expect(p.photos).toBe(DRAFT_PHOTOS);
    expect(p.canFlag).toBeUndefined();
    for (const other of [TASK_PHOTOS, IDEA_PHOTOS]) {
      expect(DRAFT_PHOTOS.cacheKey).not.toBe(other.cacheKey);
      expect(DRAFT_PHOTOS.entity).not.toBe(other.entity);
      expect(DRAFT_PHOTOS.uploadEntity).not.toBe(other.uploadEntity);
    }
  });

  it("lets any member add photos while the draft is not converted", () => {
    expect(draftParent("p1", "d1", open, "u2", "member").canManagePhotos).toBe(true);
    expect(draftParent("p1", "d1", open, "u2", "owner").canManagePhotos).toBe(true);
  });

  it("lets nobody add photos once converted, or while the draft or the person is unknown", () => {
    expect(draftParent("p1", "d1", converted, "u1", "owner").canManagePhotos).toBe(false);
    expect(draftParent("p1", "d1", null, "u1", "owner").canManagePhotos).toBe(false);
    expect(draftParent("p1", "d1", open, null, "owner").canManagePhotos).toBe(false);
    expect(draftParent("p1", "d1", open, "u1", null).canManagePhotos).toBe(false);
  });

  it("lets the adder and an Owner caption and delete a photo, and no other member", () => {
    const member = draftParent("p1", "d1", open, "u1", "member");
    expect(member.canManagePhoto?.(by("u1"))).toBe(true);
    expect(member.canManagePhoto?.(by("u2"))).toBe(false);
    expect(member.canManagePhoto?.(by(null))).toBe(false);
    const owner = draftParent("p1", "d1", open, "u9", "owner");
    expect(owner.canManagePhoto?.(by("u2"))).toBe(true);
    expect(owner.canManagePhoto?.(by(null))).toBe(true);
  });

  it("lets nobody caption or delete once converted, not even an Owner", () => {
    const owner = draftParent("p1", "d1", converted, "u1", "owner");
    expect(owner.canManagePhoto?.(by("u1"))).toBe(false);
    expect(draftParent("p1", "d1", converted, "u1", "member").canManagePhoto?.(by("u1"))).toBe(false);
  });
});
