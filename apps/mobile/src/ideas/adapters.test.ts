import { describe, expect, it } from "vitest";

import { IDEA_COMMENTS, IDEA_PHOTOS, ideaParent } from "./adapters";
import { TASK_COMMENTS, TASK_PHOTOS } from "../tasks/parent";

const author = { author: { id: "u1", displayName: "An" } };

describe("ideaParent", () => {
  it("is an idea with its own caches and queue entities, apart from the task's", () => {
    const p = ideaParent("p1", "i1", author, "u1", "member");
    expect(p).toMatchObject({ kind: "idea", projectId: "p1", id: "i1" });
    expect(p.comments).toBe(IDEA_COMMENTS);
    expect(p.photos).toBe(IDEA_PHOTOS);
    expect(IDEA_COMMENTS.cacheKey).not.toBe(TASK_COMMENTS.cacheKey);
    expect(IDEA_PHOTOS.cacheKey).not.toBe(TASK_PHOTOS.cacheKey);
    expect(IDEA_COMMENTS.entity).not.toBe(TASK_COMMENTS.entity);
    expect([IDEA_PHOTOS.uploadEntity, IDEA_PHOTOS.entity]).not.toContain(TASK_PHOTOS.entity);
    expect([IDEA_PHOTOS.uploadEntity, IDEA_PHOTOS.entity]).not.toContain(TASK_PHOTOS.uploadEntity);
  });

  it("has no reminder flag", () => {
    expect(ideaParent("p1", "i1", author, "u1", "owner").canFlag).toBeUndefined();
  });

  it("lets the author and an Owner manage photos, and nobody else", () => {
    expect(ideaParent("p1", "i1", author, "u1", "member").canManagePhotos).toBe(true);
    expect(ideaParent("p1", "i1", author, "u2", "owner").canManagePhotos).toBe(true);
    expect(ideaParent("p1", "i1", author, "u2", "member").canManagePhotos).toBe(false);
    expect(ideaParent("p1", "i1", null, "u1", "owner").canManagePhotos).toBe(false);
    expect(ideaParent("p1", "i1", author, null, "owner").canManagePhotos).toBe(false);
    expect(ideaParent("p1", "i1", author, "u1", null).canManagePhotos).toBe(false);
  });
});
