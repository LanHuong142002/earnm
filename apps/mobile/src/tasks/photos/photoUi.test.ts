import { describe, expect, it } from "vitest";

import {
  addNotice,
  afterDelete,
  captionCounter,
  overlayOf,
  pickerOptions,
  pickerProblem,
  thumbLabelKey,
  viewerStart,
} from "./photoUi";
import type { Photo } from "./types";

const photo = (over: Partial<Photo> = {}): Photo => ({
  id: "p1",
  taskId: "t1",
  addedBy: { id: "u1", displayName: "Huy" },
  caption: "",
  width: 100,
  height: 100,
  createdAt: "2026-11-12T08:20:00Z",
  thumbUrl: "https://x/t.jpg",
  url: "https://x/f.jpg",
  state: "synced",
  edit: "none",
  ...over,
});

describe("pickerOptions", () => {
  it("picks images only, several at once, never more than the free places", () => {
    expect(pickerOptions("library", 4)).toMatchObject({ mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: 4 });
  });
  it("takes one photo from the camera", () => {
    const o = pickerOptions("camera", 4);
    expect(o.allowsMultipleSelection).toBe(false);
    expect(o.selectionLimit).toBeUndefined();
  });
  it("never asks for less than one place", () => {
    expect(pickerOptions("library", 0).selectionLimit).toBe(1);
  });
});

describe("pickerProblem", () => {
  it("names the refused source", () => {
    expect(pickerProblem("camera")).toBe("tasks.photos.cameraDenied");
    expect(pickerProblem("library")).toBe("tasks.photos.libraryDenied");
  });
});

describe("addNotice", () => {
  it("is silent when everything was added", () => {
    expect(addNotice({ ok: true, added: 3, dropped: 0, failed: 0 })).toBeNull();
  });
  it("says how many were left out for lack of room", () => {
    expect(addNotice({ ok: true, added: 2, dropped: 3, failed: 0 })).toEqual({ key: "tasks.photos.droppedNotice", count: 3 });
  });
  it("says how many could not be read", () => {
    expect(addNotice({ ok: true, added: 1, dropped: 0, failed: 2 })).toEqual({ key: "tasks.photos.failedNotice", count: 2 });
  });
  it("reports left-out photos before unreadable ones", () => {
    expect(addNotice({ ok: true, added: 0, dropped: 1, failed: 1 })?.key).toBe("tasks.photos.droppedNotice");
  });
  it("explains a refusal", () => {
    expect(addNotice({ ok: false, reason: "full" })).toEqual({ key: "tasks.photos.fullLine" });
    expect(addNotice({ ok: false, reason: "not_allowed" })).toEqual({ key: "tasks.photos.notAllowed" });
    expect(addNotice({ ok: false, reason: "not_ready" })).toEqual({ key: "tasks.photos.notReady" });
  });
});

describe("overlayOf", () => {
  it("shows nothing for an uploaded photo", () => expect(overlayOf(photo())).toBe("none"));
  it("maps each local state", () => {
    expect(overlayOf(photo({ state: "uploading" }))).toBe("uploading");
    expect(overlayOf(photo({ state: "waiting" }))).toBe("waiting");
    expect(overlayOf(photo({ state: "failed" }))).toBe("failed");
  });
  it("a refused caption change or delete also asks for a retry", () => {
    expect(overlayOf(photo({ edit: "failed" }))).toBe("failed");
  });
});

describe("thumbLabelKey", () => {
  it("prefers the state over the caption", () => {
    expect(thumbLabelKey(photo({ state: "failed" }))).toBe("tasks.photos.thumbFailedA11y");
    expect(thumbLabelKey(photo({ state: "waiting" }))).toBe("tasks.photos.thumbWaitingA11y");
    expect(thumbLabelKey(photo({ state: "uploading" }))).toBe("tasks.photos.thumbUploadingA11y");
  });
  it("uses the caption variant when there is one", () => {
    expect(thumbLabelKey(photo({ caption: "Hoá đơn" }))).toBe("tasks.photos.thumbCaptionA11y");
    expect(thumbLabelKey(photo())).toBe("tasks.photos.thumbA11y");
  });
});

describe("viewerStart", () => {
  it("opens at the tapped photo", () => {
    expect(viewerStart([photo({ id: "a" }), photo({ id: "b" })], "b")).toBe(1);
  });
  it("opens at the first when the photo is unknown", () => {
    expect(viewerStart([photo({ id: "a" })], "zzz")).toBe(0);
    expect(viewerStart([photo({ id: "a" })], undefined)).toBe(0);
  });
});

describe("afterDelete", () => {
  it("moves to the next photo, which takes the same position", () => {
    expect(afterDelete(1, 4)).toBe(1);
  });
  it("moves back when the last one was deleted", () => {
    expect(afterDelete(3, 4)).toBe(2);
  });
  it("closes when none are left", () => {
    expect(afterDelete(0, 1)).toBeNull();
  });
});

describe("captionCounter", () => {
  it("stays hidden until fewer than 20 characters are left", () => {
    expect(captionCounter(100)).toBeNull();
    expect(captionCounter(180)).toBeNull();
    expect(captionCounter(181)).toEqual({ remaining: 19, over: false });
  });
  it("goes negative past the limit", () => {
    expect(captionCounter(205)).toEqual({ remaining: -5, over: true });
  });
});
