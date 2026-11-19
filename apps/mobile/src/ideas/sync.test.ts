import { describe, expect, it, vi } from "vitest";

import { createQueue, type Change, type Queue } from "../sync/queue";
import { createMemoryStore } from "../sync/storage";
import { queueTaskLabels } from "../tasks/waitingLabels";
import { idea } from "./fixtures";
import { ideaCreateChange, ideaDeleteChange, ideaLabelsChange, ideaUpdateChange, ideaVoteChange, registerIdeaEntities } from "./sync";

const T0 = new Date("2026-11-18T09:00:00.000Z");
const T1 = new Date("2026-11-18T09:01:00.000Z");
const T2 = new Date("2026-11-18T09:02:00.000Z");

function setup() {
  const applied: Change[] = [];
  const rejected: Change[] = [];
  const queue = createQueue({
    store: createMemoryStore(),
    getToken: async () => "tok",
    onApplied: () => {},
    onRejected: () => {},
    onSignedOut: () => {},
  });
  const deps = {
    createIdea: vi.fn(async (_t: string, _p: string, body: { id: string }) => idea({ id: body.id })),
    patchIdea: vi.fn(async (_t: string, _p: string, id: string) => idea({ id })),
    deleteIdea: vi.fn(async () => undefined),
    putVote: vi.fn(async (_t: string, _p: string, id: string) => idea({ id })),
  };
  registerIdeaEntities(queue, { onApplied: (c) => void applied.push(c), onRejected: (c) => void rejected.push(c) }, deps);
  return { queue, deps, applied, rejected };
}

const ids = async (queue: Queue) => (await queue.waiting()).map((c) => `${c.entity}:${c.entityId}:${c.kind}`);

describe("queued idea changes (spec AC22)", () => {
  it("merges edits of one idea into one change, field by field", async () => {
    const { queue } = setup();
    await queue.enqueue(ideaUpdateChange({ id: "i1", projectId: "p1", fields: { title: "A" }, now: T0 }));
    await queue.enqueue(ideaUpdateChange({ id: "i1", projectId: "p1", fields: { title: "B", status: "accepted" }, now: T1 }));
    await queue.enqueue(ideaUpdateChange({ id: "i1", projectId: "p1", fields: { description: "D" }, now: T2 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0].data).toMatchObject({ title: "B", status: "accepted", description: "D" });
    expect(waiting[0].fieldTimes).toMatchObject({ title: T1.toISOString(), status: T1.toISOString(), description: T2.toISOString() });
  });

  it("keeps edits of two ideas apart", async () => {
    const { queue } = setup();
    await queue.enqueue(ideaUpdateChange({ id: "i1", projectId: "p1", fields: { title: "A" }, now: T0 }));
    await queue.enqueue(ideaUpdateChange({ id: "i2", projectId: "p1", fields: { title: "B" }, now: T0 }));
    expect(await ids(queue)).toEqual(["idea:i1:update", "idea:i2:update"]);
  });

  it("keeps one vote per idea: the last one wins", async () => {
    const { queue } = setup();
    await queue.enqueue(ideaVoteChange({ id: "i1", projectId: "p1", value: 1, now: T0 }));
    await queue.enqueue(ideaVoteChange({ id: "i2", projectId: "p1", value: -1, now: T0 }));
    await queue.enqueue(ideaVoteChange({ id: "i1", projectId: "p1", value: 0, now: T1 }));
    await queue.enqueue(ideaVoteChange({ id: "i1", projectId: "p1", value: -1, now: T2 }));
    const waiting = await queue.waiting();
    expect(await ids(queue)).toEqual(["ideaVote:i1:update", "ideaVote:i2:update"]);
    expect(waiting.map((c) => c.data.value)).toEqual([-1, -1]);
  });

  it("folds an edit into the idea's own waiting create, and deleting it sends nothing", async () => {
    const { queue } = setup();
    await queue.enqueue(ideaCreateChange({ id: "i1", projectId: "p1", title: "A", description: "", author: null, now: T0 }));
    await queue.enqueue(ideaUpdateChange({ id: "i1", projectId: "p1", fields: { title: "B", status: "considering" }, now: T1 }));
    const waiting = await queue.waiting();
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "create", data: { title: "B", status: "considering" } });
    await queue.enqueue(ideaDeleteChange({ id: "i1", projectId: "p1" }));
    expect(await queue.waiting()).toEqual([]);
  });

  it("keeps the label set apart from the idea's fields, and moves it behind a label create it names", async () => {
    const { queue } = setup();
    queue.registerEntity("label", { create: async () => ({}), update: async () => ({}), delete: async () => ({}) });
    await queue.enqueue(ideaLabelsChange({ id: "i1", projectId: "p1", labelIds: ["old"], now: T0 }));
    await queue.enqueue({ entity: "label", entityId: "new", kind: "create", data: { projectId: "p1", name: "N", colour: "red" } });
    await queueTaskLabels(queue, ideaLabelsChange({ id: "i1", projectId: "p1", labelIds: ["old", "new"], now: T1 }));
    expect(await ids(queue)).toEqual(["label:new:create", "ideaLabels:i1:update"]);
    expect((await queue.waiting())[1].data.labels).toEqual(["old", "new"]);
  });
});

describe("sending idea changes", () => {
  it("creates without labels, then sends a status chosen meanwhile as its own patch", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(ideaCreateChange({ id: "i1", projectId: "p1", title: "A", description: "D", author: null, now: T0 }));
    await queue.enqueue(ideaUpdateChange({ id: "i1", projectId: "p1", fields: { status: "accepted" }, now: T1 }));
    await queue.flush();
    expect(deps.createIdea).toHaveBeenCalledWith("tok", "p1", { id: "i1", title: "A", description: "D" });
    expect(deps.patchIdea).toHaveBeenCalledWith("tok", "p1", "i1", { status: { value: "accepted", editedAt: T1.toISOString() } });
  });

  it("sends only the changed fields of an update, each with its own time", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(ideaUpdateChange({ id: "i1", projectId: "p1", fields: { title: "B" }, now: T0 }));
    await queue.enqueue(ideaUpdateChange({ id: "i1", projectId: "p1", fields: { status: "dropped" }, now: T1 }));
    await queue.flush();
    expect(deps.patchIdea).toHaveBeenCalledTimes(1);
    expect(deps.patchIdea).toHaveBeenCalledWith("tok", "p1", "i1", {
      title: { value: "B", editedAt: T0.toISOString() },
      status: { value: "dropped", editedAt: T1.toISOString() },
    });
  });

  it("sends the label set after the idea is created, as the labels field", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(ideaCreateChange({ id: "i1", projectId: "p1", title: "A", description: "", author: null, now: T0 }));
    await queue.enqueue(ideaLabelsChange({ id: "i1", projectId: "p1", labelIds: ["l1"], now: T0 }));
    await queue.flush();
    expect(deps.createIdea.mock.invocationCallOrder[0]).toBeLessThan(deps.patchIdea.mock.invocationCallOrder[0]);
    expect(deps.patchIdea).toHaveBeenCalledWith("tok", "p1", "i1", { labels: { value: ["l1"], editedAt: T0.toISOString() } });
  });

  it("puts the vote with the value, and deletes", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(ideaVoteChange({ id: "i1", projectId: "p1", value: -1, now: T0 }));
    await queue.enqueue(ideaDeleteChange({ id: "i2", projectId: "p1" }));
    await queue.flush();
    expect(deps.putVote).toHaveBeenCalledWith("tok", "p1", "i1", -1);
    expect(deps.deleteIdea).toHaveBeenCalledWith("tok", "p1", "i2");
  });
});
