import { describe, expect, it } from "vitest";

import {
  CAPTION_MAX,
  GRID_MAX,
  PHOTO_MAX,
  acceptPicks,
  addState,
  canCaption,
  canRemove,
  captionCheck,
  freePlaces,
  gridOf,
  photoCount,
  showSection,
  sortPhotos,
} from "./view";
import type { Photo, PhotoState } from "./types";

const photo = (id: string, state: PhotoState = "synced", over: Partial<Photo> = {}): Photo => ({
  id,
  taskId: "t1",
  addedBy: { id: "u1", displayName: "Lan" },
  caption: "",
  width: 100,
  height: 100,
  createdAt: "2026-11-01T00:00:00.000Z",
  thumbUrl: `thumb-${id}`,
  url: `url-${id}`,
  state,
  edit: "none",
  ...over,
});

const many = (n: number, state: PhotoState = "synced") => Array.from({ length: n }, (_, i) => photo(`p${String(i).padStart(2, "0")}`, state));

describe("count and free places", () => {
  it("counts photos still waiting or uploading toward the 10", () => {
    const list = [photo("a"), photo("b", "waiting"), photo("c", "uploading")];
    expect(photoCount(list)).toBe(3);
    expect(freePlaces(list)).toBe(PHOTO_MAX - 3);
  });

  it("does not count a failed upload, which holds no place until it is retried", () => {
    expect(photoCount([photo("a"), photo("b", "failed")])).toBe(1);
  });

  it("never reports fewer than zero free places", () => {
    expect(freePlaces(many(12))).toBe(0);
  });
});

describe("adding", () => {
  it("is open for an involved person with places left", () => {
    expect(addState(true, many(3))).toBe("open");
  });

  it("is full at 10 even when some of the 10 are still waiting", () => {
    expect(addState(true, [...many(8), photo("w1", "waiting"), photo("w2", "waiting")])).toBe("full");
  });

  it("is not offered to someone who is not involved", () => {
    expect(addState(false, many(2))).toBe("hidden");
    expect(addState(false, many(10))).toBe("hidden");
  });

  it("cuts a pick to the free places and says how many were left out", () => {
    expect(acceptPicks(3, 7)).toEqual({ take: 3, dropped: 0 });
    expect(acceptPicks(5, 2)).toEqual({ take: 2, dropped: 3 });
    expect(acceptPicks(2, 0)).toEqual({ take: 0, dropped: 2 });
  });
});

describe("the section", () => {
  it("shows for an involved person even with no photos", () => {
    expect(showSection(true, [])).toBe(true);
  });

  it("is hidden for a member who is not involved and sees no photos", () => {
    expect(showSection(false, [])).toBe(false);
  });

  it("shows for a member who is not involved when the task has photos", () => {
    expect(showSection(false, [photo("a")])).toBe(true);
  });
});

describe("the grid", () => {
  it("shows every photo up to 8 with no +N", () => {
    const g = gridOf(many(8));
    expect(g.tiles).toHaveLength(GRID_MAX);
    expect(g.overflow).toBe(0);
  });

  it("with 10 photos shows 8 tiles and +3 on the 8th", () => {
    const g = gridOf(many(10));
    expect(g.tiles.map((t) => t.id)).toEqual(many(8).map((t) => t.id));
    expect(g.overflow).toBe(3);
  });

  it("with 9 photos the 8th shows +2", () => {
    expect(gridOf(many(9)).overflow).toBe(2);
  });

  it("has no tiles for no photos", () => {
    expect(gridOf([])).toEqual({ tiles: [], overflow: 0 });
  });
});

describe("who can do what to a photo", () => {
  it("lets an involved person remove an uploaded photo and one that waits or failed, but not one mid-upload", () => {
    expect(canRemove(true, photo("a"))).toBe(true);
    expect(canRemove(true, photo("a", "waiting"))).toBe(true);
    expect(canRemove(true, photo("a", "failed"))).toBe(true);
    expect(canRemove(true, photo("a", "uploading"))).toBe(false);
  });

  it("lets only an involved person caption, and only a photo the server has", () => {
    expect(canCaption(true, photo("a"))).toBe(true);
    expect(canCaption(true, photo("a", "waiting"))).toBe(false);
    expect(canCaption(false, photo("a"))).toBe(false);
    expect(canRemove(false, photo("a"))).toBe(false);
  });

  it("asks to retry or discard a refused change before another caption change", () => {
    expect(canCaption(true, photo("a", "synced", { edit: "failed" }))).toBe(false);
    expect(canCaption(true, photo("a", "synced", { edit: "waiting" }))).toBe(true);
  });
});

describe("caption length", () => {
  it("allows 0 to 200 characters after trimming", () => {
    expect(captionCheck("  ").canSave).toBe(true);
    expect(captionCheck("").value).toBe("");
    expect(captionCheck("x".repeat(CAPTION_MAX)).canSave).toBe(true);
    expect(captionCheck(` ${"x".repeat(CAPTION_MAX)} `).canSave).toBe(true);
  });

  it("refuses 201 characters and says how many to remove", () => {
    const c = captionCheck("x".repeat(CAPTION_MAX + 1));
    expect(c.canSave).toBe(false);
    expect(c.over).toBe(1);
    expect(c.length).toBe(201);
  });

  it("hands back the trimmed value to save", () => {
    expect(captionCheck("  Hoá đơn  ").value).toBe("Hoá đơn");
  });
});

describe("order", () => {
  it("sorts by time then id, oldest first", () => {
    const sorted = sortPhotos([
      photo("b", "synced", { createdAt: "2026-11-02T00:00:00.000Z" }),
      photo("z", "synced", { createdAt: "2026-11-01T00:00:00.000Z" }),
      photo("a", "synced", { createdAt: "2026-11-01T00:00:00.000Z" }),
    ]);
    expect(sorted.map((p) => p.id)).toEqual(["a", "z", "b"]);
  });
});
