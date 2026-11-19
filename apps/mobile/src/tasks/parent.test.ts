import { describe, expect, it } from "vitest";

import { bellFor } from "./comments/view";
import { TASK_COMMENTS, TASK_PHOTOS, taskParent } from "./parent";

const task = { createdById: "u1", assignees: [{ id: "u2", displayName: "B" }] };

describe("taskParent", () => {
  it("files the task under its own caches and queue entities", () => {
    const p = taskParent("p1", "t1", task, "u1");
    expect(p).toMatchObject({ kind: "task", projectId: "p1", id: "t1" });
    expect(p.comments).toBe(TASK_COMMENTS);
    expect(p.photos).toBe(TASK_PHOTOS);
    expect(TASK_COMMENTS.entity).toBe("comment");
    expect(TASK_PHOTOS.uploadEntity).toBe("photoUpload");
    expect(TASK_PHOTOS.entity).toBe("photo");
    expect(TASK_COMMENTS.cacheKey).toBe("comments.cache.v1");
    expect(TASK_PHOTOS.cacheKey).toBe("photos.cache.v1");
  });

  it("lets the creator and an assignee flag comments and manage photos", () => {
    expect(taskParent("p1", "t1", task, "u1")).toMatchObject({ canFlag: true, canManagePhotos: true });
    expect(taskParent("p1", "t1", task, "u2")).toMatchObject({ canFlag: true, canManagePhotos: true });
  });

  it("keeps everyone else out, and keeps an unknown task or person out", () => {
    expect(taskParent("p1", "t1", task, "u3")).toMatchObject({ canFlag: false, canManagePhotos: false });
    expect(taskParent("p1", "t1", null, "u1")).toMatchObject({ canFlag: false, canManagePhotos: false });
    expect(taskParent("p1", "t1", task, null)).toMatchObject({ canFlag: false, canManagePhotos: false });
  });
});

describe("bellFor", () => {
  it("is the task bell when the parent has the reminder flag", () => {
    expect(bellFor(true, true)).toBe("on");
    expect(bellFor(true, false)).toBe("off-tappable");
    expect(bellFor(false, true)).toBe("on-readonly");
    expect(bellFor(false, false)).toBe("hidden");
  });

  it("is hidden when the parent has no reminder flag", () => {
    expect(bellFor(undefined, true)).toBe("hidden");
    expect(bellFor(undefined, false)).toBe("hidden");
  });
});
