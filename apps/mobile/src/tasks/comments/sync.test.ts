import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { createQueue, type Change, type NewChange, type Queue } from "../../sync/queue";
import { createMemoryStore } from "../../sync/storage";
import { COMMENT_ENTITY } from "../entities";
import { loadCommentCache } from "./store";
import {
  commentCreateChange,
  commentDeleteChange,
  commentRemindChange,
  commentTextChange,
  discardFailed,
  registerCommentEntity,
  retryFailed,
  settleFailures,
} from "./sync";
import type { ServerComment } from "./types";

const NOW = new Date("2026-11-12T09:00:00.000Z");
const LATER = new Date("2026-11-12T09:05:00.000Z");
const ctx = { projectId: "p1", taskId: "t1" };

const saved = (id: string): ServerComment => ({
  id,
  taskId: "t1",
  author: null,
  text: "",
  edited: false,
  remindWith: false,
  createdAt: NOW.toISOString(),
});

function setup(overrides: Partial<Parameters<typeof registerCommentEntity>[2]> = {}) {
  const store = createMemoryStore();
  const applied: Change[] = [];
  const rejected: Change[] = [];
  const queue = createQueue({
    store,
    getToken: async () => "tok",
    onApplied: (c) => void applied.push(c),
    onRejected: (c) => void rejected.push(c),
    onSignedOut: () => {},
  });
  const deps = {
    createComment: vi.fn(async (_t: string, _p: string, _task: string, body: { id: string }) => saved(body.id)),
    patchComment: vi.fn(async (_t: string, _p: string, _task: string, id: string) => saved(id)),
    deleteComment: vi.fn(async () => undefined),
    ...overrides,
  };
  registerCommentEntity(queue, store, deps);
  return { store, queue, deps, applied, rejected };
}

async function enqueue(queue: Queue, change: NewChange) {
  await queue.enqueue(change);
}

describe("comment changes", () => {
  it("a create carries the text, the flag and who wrote it", () => {
    const change = commentCreateChange({ ...ctx, id: "c1", text: "hi", remindWith: true, author: { id: "me", displayName: "Mai" }, now: NOW });
    expect(change).toMatchObject({ entity: COMMENT_ENTITY, entityId: "c1", kind: "create" });
    expect(change.data).toEqual({ ...ctx, text: "hi", remindWith: true, authorId: "me", authorName: "Mai" });
  });

  it("text and the flag are separate fields, each with its own time", () => {
    const text = commentTextChange({ ...ctx, id: "c1", text: "new", now: NOW });
    const flag = commentRemindChange({ ...ctx, id: "c1", remindWith: true, now: LATER });
    expect(text.data).toEqual({ ...ctx, text: "new" });
    expect(text.fieldTimes).toEqual({ text: NOW.toISOString() });
    expect(flag.data).toEqual({ ...ctx, remindWith: true });
    expect(flag.fieldTimes).toEqual({ remindWith: LATER.toISOString() });
  });

  it("a delete names only the comment", () => {
    expect(commentDeleteChange({ ...ctx, id: "c1" })).toMatchObject({ entity: COMMENT_ENTITY, entityId: "c1", kind: "delete", data: ctx });
  });
});

describe("registerCommentEntity", () => {
  it("sends a create with the id, the trimmed-by-server text and the flag only when it is on", async () => {
    const { queue, deps } = setup();
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c1", text: "hi", remindWith: false, author: { id: "me", displayName: "Mai" }, now: NOW }));
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c2", text: "yo", remindWith: true, author: { id: "me", displayName: "Mai" }, now: NOW }));
    await queue.flush();
    expect(deps.createComment).toHaveBeenNthCalledWith(1, "tok", "p1", "t1", { id: "c1", text: "hi" });
    expect(deps.createComment).toHaveBeenNthCalledWith(2, "tok", "p1", "t1", { id: "c2", text: "yo", remindWith: true });
  });

  it("an edit and a flag change made while offline go as one request with separate field times", async () => {
    const { queue, deps } = setup();
    await enqueue(queue, commentTextChange({ ...ctx, id: "c1", text: "new", now: NOW }));
    await enqueue(queue, commentRemindChange({ ...ctx, id: "c1", remindWith: true, now: LATER }));
    await queue.flush();
    expect(deps.patchComment).toHaveBeenCalledTimes(1);
    expect(deps.patchComment).toHaveBeenCalledWith("tok", "p1", "t1", "c1", {
      text: { value: "new", editedAt: NOW.toISOString() },
      remindWith: { value: true, editedAt: LATER.toISOString() },
    });
  });

  it("two text edits leave one request with the later text; a flag alone sends only the flag", async () => {
    const { queue, deps } = setup();
    await enqueue(queue, commentTextChange({ ...ctx, id: "c1", text: "one", now: NOW }));
    await enqueue(queue, commentTextChange({ ...ctx, id: "c1", text: "two", now: LATER }));
    await enqueue(queue, commentRemindChange({ ...ctx, id: "c2", remindWith: false, now: NOW }));
    await queue.flush();
    expect(deps.patchComment).toHaveBeenNthCalledWith(1, "tok", "p1", "t1", "c1", { text: { value: "two", editedAt: LATER.toISOString() } });
    expect(deps.patchComment).toHaveBeenNthCalledWith(2, "tok", "p1", "t1", "c2", { remindWith: { value: false, editedAt: NOW.toISOString() } });
  });

  it("an edit while the create still waits folds into the create; create then delete sends nothing", async () => {
    const { queue, deps } = setup();
    const author = { id: "me", displayName: "Mai" };
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c1", text: "hi", remindWith: false, author, now: NOW }));
    await enqueue(queue, commentTextChange({ ...ctx, id: "c1", text: "hello", now: LATER }));
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c2", text: "gone", remindWith: false, author, now: NOW }));
    await enqueue(queue, commentDeleteChange({ ...ctx, id: "c2" }));
    await queue.flush();
    expect(deps.createComment).toHaveBeenCalledTimes(1);
    expect(deps.createComment).toHaveBeenCalledWith("tok", "p1", "t1", { id: "c1", text: "hello" });
    expect(deps.patchComment).not.toHaveBeenCalled();
    expect(deps.deleteComment).not.toHaveBeenCalled();
  });

  it("sends a delete", async () => {
    const { queue, deps } = setup();
    await enqueue(queue, commentDeleteChange({ ...ctx, id: "c1" }));
    await queue.flush();
    expect(deps.deleteComment).toHaveBeenCalledWith("tok", "p1", "t1", "c1");
  });
});

describe("a permanent refusal", () => {
  it("keeps the change as failed for that comment and does not reach the task-wide handler", async () => {
    const { queue, store, rejected } = setup({
      createComment: vi.fn(async () => {
        throw new ApiError("forbidden", 403);
      }),
    });
    await queue.setOwner("me");
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c1", text: "hi", remindWith: true, author: { id: "me", displayName: "Mai" }, now: NOW }));
    await queue.flush();
    await settleFailures();
    expect(rejected).toEqual([]);
    expect(await queue.count()).toBe(0);
    const cache = await loadCommentCache(store, "me");
    expect(cache.failed).toHaveLength(1);
    expect(cache.failed[0]).toMatchObject({ entityId: "c1", kind: "create" });
    expect(cache.failed[0]!.attempts).toBeUndefined();
  });

  it("a refused 404 on a create (task gone) is also kept as failed, a network error is not", async () => {
    const { queue, store } = setup({
      createComment: vi.fn(async (_t: string, _p: string, _task: string, body: { id: string }) => {
        throw body.id === "c1" ? new ApiError("not_found", 404) : new ApiError("network");
      }),
    });
    await queue.setOwner("me");
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c1", text: "hi", remindWith: false, author: null, now: NOW }));
    await queue.flush();
    await settleFailures();
    expect((await loadCommentCache(store, "me")).failed).toHaveLength(1);
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c2", text: "yo", remindWith: false, author: null, now: NOW }));
    await queue.flush();
    expect(await queue.count()).toBe(1); // the network failure waits for a retry by the queue
    expect((await loadCommentCache(store, "me")).failed).toHaveLength(1);
  });

  it("retry sends a failed create without the reminder flag", async () => {
    const refuse = vi.fn(async () => {
      throw new ApiError("forbidden", 403);
    });
    const { queue, store } = setup({ createComment: refuse });
    await queue.setOwner("me");
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c1", text: "hi", remindWith: true, author: null, now: NOW }));
    await queue.flush();
    await settleFailures();
    await retryFailed(queue, store, "me", "c1");
    const waiting = await queue.waiting();
    expect(waiting[0]).toMatchObject({ entityId: "c1", kind: "create", data: { text: "hi", remindWith: false } });
  });

  it("retry puts the failed changes of that comment back on the queue; discard drops them", async () => {
    const refuse = vi.fn(async () => {
      throw new ApiError("validation_failed", 400);
    });
    const { queue, store } = setup({ createComment: refuse });
    await queue.setOwner("me");
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c1", text: "hi", remindWith: false, author: null, now: NOW }));
    await enqueue(queue, commentCreateChange({ ...ctx, id: "c2", text: "yo", remindWith: false, author: null, now: NOW }));
    await queue.flush();
    await settleFailures();
    expect((await loadCommentCache(store, "me")).failed).toHaveLength(2);

    await retryFailed(queue, store, "me", "c1");
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ entityId: "c1", kind: "create", data: { text: "hi" } });
    expect((await loadCommentCache(store, "me")).failed.map((c) => c.entityId)).toEqual(["c2"]);

    await discardFailed(store, "me", "c2");
    expect((await loadCommentCache(store, "me")).failed).toEqual([]);
  });
});
