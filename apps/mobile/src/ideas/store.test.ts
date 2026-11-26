import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../sync/storage";
import { idea } from "./fixtures";
import {
  clearIdeaCache,
  emptyIdeaCache,
  hasIdeas,
  ideasOf,
  isIdea,
  loadIdeaCache,
  openIdeaCache,
  pruneIdeaCache,
  saveIdeaCache,
  setProjectIdeas,
  withIdea,
  withoutIdea,
} from "./store";

describe("idea cache", () => {
  it("round-trips for its owner and is empty for anyone else", async () => {
    const store = createMemoryStore();
    await saveIdeaCache(store, setProjectIdeas(emptyIdeaCache("u1"), "p1", [idea({ id: "i1" })]));
    expect(ideasOf(await loadIdeaCache(store, "u1"), "p1").map((i) => i.id)).toEqual(["i1"]);
    expect(await loadIdeaCache(store, "u2")).toEqual(emptyIdeaCache("u2"));
  });

  it("removes another person's copy when it is opened", async () => {
    const store = createMemoryStore();
    await saveIdeaCache(store, setProjectIdeas(emptyIdeaCache("u1"), "p1", [idea({ id: "i1" })]));
    expect(await openIdeaCache(store, "u2")).toEqual(emptyIdeaCache("u2"));
    expect(await store.getJSON("ideas.cache.v1")).toBeNull();
  });

  it("distrusts only the project whose copy is malformed", async () => {
    const store = createMemoryStore();
    await store.setJSON("ideas.cache.v1", { ownerId: "u1", byProject: { p1: [idea({ id: "i1" })], p2: [{ id: "x" }] } });
    const cache = await loadIdeaCache(store, "u1");
    expect(hasIdeas(cache, "p1")).toBe(true);
    expect(hasIdeas(cache, "p2")).toBe(false);
  });

  it("knows a project that was fetched with no ideas from one that was never fetched", () => {
    const cache = setProjectIdeas(emptyIdeaCache("u1"), "p1", []);
    expect(hasIdeas(cache, "p1")).toBe(true);
    expect(hasIdeas(cache, "p2")).toBe(false);
  });

  it("replaces or adds an idea in a list, and removes one", () => {
    let list = [idea({ id: "a", title: "A" })];
    list = withIdea(list, idea({ id: "a", title: "A2" }));
    list = withIdea(list, idea({ id: "b" }));
    expect(list.map((i) => i.title)).toEqual(["A2", "Ý tưởng"]);
    expect(withoutIdea(list, "a").map((i) => i.id)).toEqual(["b"]);
  });

  it("prunes the projects that are gone", () => {
    const cache = setProjectIdeas(setProjectIdeas(emptyIdeaCache("u1"), "p1", []), "p2", []);
    expect(Object.keys(pruneIdeaCache(cache, ["p2"]).byProject)).toEqual(["p2"]);
  });

  it("clears", async () => {
    const store = createMemoryStore();
    await saveIdeaCache(store, emptyIdeaCache("u1"));
    await clearIdeaCache(store);
    expect(await store.getJSON("ideas.cache.v1")).toBeNull();
  });

  it("keeps an idea cached by the old app, with the counts filled from its score", async () => {
    const store = createMemoryStore();
    const { likeCount: _l, dislikeCount: _d, ...old } = idea({ id: "a", score: -2 });
    await store.setJSON("ideas.cache.v1", { ownerId: "u1", byProject: { p1: [old] } });
    const cache = await loadIdeaCache(store, "u1");
    expect(ideasOf(cache, "p1")[0]).toMatchObject({ likeCount: 0, dislikeCount: 2 });
    expect(isIdea(old)).toBe(true);
    expect(isIdea({ ...old, likeCount: "x" })).toBe(false);
  });

  it("isIdea checks the shape", () => {
    expect(isIdea(idea({ id: "a" }))).toBe(true);
    expect(isIdea(idea({ id: "a", author: null, task: { id: "t", title: "T", status: "todo" }, taskId: "t" }))).toBe(true);
    expect(isIdea({ ...idea({ id: "a" }), status: "nope" })).toBe(false);
    expect(isIdea({ ...idea({ id: "a" }), myVote: 2 })).toBe(false);
    expect(isIdea(null)).toBe(false);
  });
});
