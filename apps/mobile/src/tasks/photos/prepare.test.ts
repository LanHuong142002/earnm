import { describe, expect, it, vi } from "vitest";

import { JPEG_QUALITY, MAX_SIDE, preparePhoto, resizeFor, type PrepareDeps } from "./prepare";

describe("resize options", () => {
  it("keeps the longer side at 1600 px and saves JPEG at 0.7", () => {
    expect(MAX_SIDE).toBe(1600);
    expect(JPEG_QUALITY).toBe(0.7);
  });

  it("shrinks a landscape photo by its width", () => {
    expect(resizeFor(4000, 3000)).toEqual({ width: 1600 });
  });

  it("shrinks a portrait photo by its height", () => {
    expect(resizeFor(3000, 4000)).toEqual({ height: 1600 });
  });

  it("shrinks a square photo", () => {
    expect(resizeFor(2000, 2000)).toEqual({ width: 1600 });
  });

  it("never enlarges a photo that is already small", () => {
    expect(resizeFor(1600, 900)).toBeNull();
    expect(resizeFor(800, 600)).toBeNull();
  });

  it("does not guess when the size is unknown", () => {
    expect(resizeFor(0, 0)).toBeNull();
    expect(resizeFor(Number.NaN, 100)).toBeNull();
  });
});

describe("preparePhoto", () => {
  const deps = (results: { uri: string; width: number; height: number }[]) => {
    const manipulate = vi.fn(async (_uri: string, _resize: { width: number } | { height: number } | null, _quality: number) => results.shift()!);
    const store = vi.fn(async (_id: string, _from: string) => {});
    return { manipulate, store } satisfies PrepareDeps;
  };

  it("resizes, saves a JPEG copy under the photo id and reports its size", async () => {
    const d = deps([{ uri: "file:///cache/a.jpg", width: 1600, height: 1200 }]);
    const out = await preparePhoto({ uri: "file:///pick/a.heic", width: 4000, height: 3000 }, "id1", d);
    expect(d.manipulate).toHaveBeenCalledWith("file:///pick/a.heic", { width: 1600 }, 0.7);
    expect(d.store).toHaveBeenCalledWith("id1", "file:///cache/a.jpg");
    expect(out).toEqual({ id: "id1", width: 1600, height: 1200 });
  });

  it("still re-encodes a small photo as JPEG without resizing it", async () => {
    const d = deps([{ uri: "file:///cache/b.jpg", width: 800, height: 600 }]);
    await preparePhoto({ uri: "file:///pick/b.png", width: 800, height: 600 }, "id2", d);
    expect(d.manipulate).toHaveBeenCalledWith("file:///pick/b.png", null, 0.7);
  });

  it("shrinks again when the picker gave no size and the result is too large", async () => {
    const d = deps([
      { uri: "file:///cache/c1.jpg", width: 3000, height: 2000 },
      { uri: "file:///cache/c2.jpg", width: 1600, height: 1067 },
    ]);
    const out = await preparePhoto({ uri: "file:///pick/c.jpg", width: 0, height: 0 }, "id3", d);
    expect(d.manipulate).toHaveBeenNthCalledWith(2, "file:///cache/c1.jpg", { width: 1600 }, 0.7);
    expect(d.store).toHaveBeenCalledWith("id3", "file:///cache/c2.jpg");
    expect(out.width).toBe(1600);
  });

  it("reports whole numbers the server accepts", async () => {
    const d = deps([{ uri: "file:///cache/d.jpg", width: 1600.4, height: 900.6 }]);
    const out = await preparePhoto({ uri: "file:///pick/d.jpg", width: 3200, height: 1800 }, "id4", d);
    expect(out).toEqual({ id: "id4", width: 1600, height: 901 });
  });
});
