import { describe, expect, it } from "vitest";

import { nextLoadState, taskListState } from "./listState";

describe("taskListState", () => {
  it("is loading until the local copy is ready", () => {
    expect(taskListState({ ready: false, cachedCount: 0, loaded: false, failed: false })).toBe("loading");
  });
  it("is loading on an empty cache before any answer", () => {
    expect(taskListState({ ready: true, cachedCount: 0, loaded: false, failed: false })).toBe("loading");
  });
  it("shows an error, not the empty invitation, when the first fetch failed on an empty cache", () => {
    expect(taskListState({ ready: true, cachedCount: 0, loaded: false, failed: true })).toBe("error");
  });
  it("shows cached tasks even when the fetch failed", () => {
    expect(taskListState({ ready: true, cachedCount: 2, loaded: false, failed: true })).toBe("content");
  });
  it("shows content (and so the empty invitation) once a fetch succeeded", () => {
    expect(taskListState({ ready: true, cachedCount: 0, loaded: true, failed: false })).toBe("content");
  });
});

describe("nextLoadState", () => {
  const start = { loaded: false, failed: false };
  it("ok counts as loaded and clears the failure", () => {
    expect(nextLoadState({ loaded: false, failed: true }, "ok")).toEqual({ loaded: true, failed: false });
  });
  it("offline marks a failure but keeps an earlier load", () => {
    expect(nextLoadState(start, "offline")).toEqual({ loaded: false, failed: true });
    expect(nextLoadState({ loaded: true, failed: false }, "offline")).toEqual({ loaded: true, failed: true });
  });
  it("gone and skipped change nothing", () => {
    expect(nextLoadState(start, "gone")).toEqual(start);
    expect(nextLoadState(start, "skipped")).toEqual(start);
  });
});
