import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { createQueue, type Change } from "../../sync/queue";
import { createMemoryStore } from "../../sync/storage";
import { REMINDER_ENTITY } from "../entities";
import {
  registerReminderEntity,
  reminderCreateChange,
  reminderDeleteChange,
  reminderRecipientsChange,
  reminderRejectedOutcome,
  reminderScheduleChange,
} from "./sync";
import type { ReminderSchedule, ServerReminder } from "./types";

const NOW = new Date("2026-11-12T09:00:00.000Z");
const LATER = new Date("2026-11-12T09:05:00.000Z");
const ctx = { projectId: "p1", taskId: "t1" };
const schedule: ReminderSchedule = { startDate: "2026-11-20", time: "09:00", timezone: "Asia/Ho_Chi_Minh", repeat: "daily", weekdays: [], endDate: null };
const saved = (id: string): ServerReminder => ({ id, taskId: "t1", ...schedule, recipientIds: ["me"], createdById: "me", changedAt: NOW.toISOString() });

function setup() {
  const store = createMemoryStore();
  const applied: Change[] = [];
  const rejected: Change[] = [];
  const handlers = { onApplied: vi.fn((c: Change) => void applied.push(c)), onRejected: vi.fn((c: Change) => void rejected.push(c)) };
  const queue = createQueue({
    store,
    getToken: async () => "tok",
    onApplied: () => {},
    onRejected: () => {},
    onSignedOut: () => {},
  });
  const deps = {
    createReminder: vi.fn(async (_t: string, _p: string, _task: string, body: { id: string }) => saved(body.id)),
    patchReminder: vi.fn(async (_t: string, _p: string, _task: string, id: string, _fields?: unknown) => saved(id)),
    deleteReminder: vi.fn(async () => undefined),
  };
  registerReminderEntity(queue, handlers, deps);
  return { queue, deps, handlers, applied, rejected };
}

describe("reminder changes", () => {
  it("a create carries the schedule and the recipients as separate timed fields", () => {
    const change = reminderCreateChange({ ...ctx, id: "r1", schedule, recipients: ["a"], now: NOW });
    expect(change).toMatchObject({ entity: REMINDER_ENTITY, entityId: "r1", kind: "create" });
    expect(change.data).toEqual({ ...ctx, schedule, recipients: ["a"] });
    expect(change.fieldTimes).toEqual({ schedule: NOW.toISOString(), recipients: NOW.toISOString() });
  });

  it("schedule and recipients are separate fields, each with its own time", () => {
    const s = reminderScheduleChange({ ...ctx, id: "r1", schedule, now: NOW });
    const r = reminderRecipientsChange({ ...ctx, id: "r1", recipients: ["a", "b"], now: LATER });
    expect(s.data).toEqual({ ...ctx, schedule });
    expect(s.fieldTimes).toEqual({ schedule: NOW.toISOString() });
    expect(r.data).toEqual({ ...ctx, recipients: ["a", "b"] });
    expect(r.fieldTimes).toEqual({ recipients: LATER.toISOString() });
  });
});

describe("registerReminderEntity", () => {
  it("sends a create with the schedule and recipientIds (AC28)", async () => {
    const { queue, deps, applied } = setup();
    await queue.enqueue(reminderCreateChange({ ...ctx, id: "r1", schedule, recipients: ["a", "b"], now: NOW }));
    await queue.flush();
    expect(deps.createReminder).toHaveBeenCalledWith("tok", "p1", "t1", { id: "r1", ...schedule, recipientIds: ["a", "b"] });
    expect(applied.map((c) => c.entityId)).toEqual(["r1"]);
  });

  it("merges edits made while a create waits into one request", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(reminderCreateChange({ ...ctx, id: "r1", schedule, recipients: ["a"], now: NOW }));
    await queue.enqueue(reminderScheduleChange({ ...ctx, id: "r1", schedule: { ...schedule, time: "20:00" }, now: LATER }));
    await queue.enqueue(reminderRecipientsChange({ ...ctx, id: "r1", recipients: ["a", "b"], now: LATER }));
    await queue.flush();
    expect(deps.createReminder).toHaveBeenCalledTimes(1);
    expect(deps.createReminder).toHaveBeenCalledWith("tok", "p1", "t1", { id: "r1", ...schedule, time: "20:00", recipientIds: ["a", "b"] });
    expect(deps.patchReminder).not.toHaveBeenCalled();
  });

  it("sends an update of only the changed field, with its own time", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(reminderRecipientsChange({ ...ctx, id: "r1", recipients: ["a"], now: NOW }));
    await queue.enqueue(reminderScheduleChange({ ...ctx, id: "r1", schedule, now: LATER }));
    await queue.flush();
    expect(deps.patchReminder).toHaveBeenCalledTimes(1);
    expect(deps.patchReminder).toHaveBeenCalledWith("tok", "p1", "t1", "r1", {
      schedule: { value: schedule, editedAt: LATER.toISOString() },
      recipients: { value: ["a"], editedAt: NOW.toISOString() },
    });
  });

  it("the newer edit of one field wins and the other field keeps its own time", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(reminderScheduleChange({ ...ctx, id: "r1", schedule: { ...schedule, time: "10:00" }, now: LATER }));
    await queue.enqueue(reminderScheduleChange({ ...ctx, id: "r1", schedule: { ...schedule, time: "11:00" }, now: new Date(LATER.getTime() + 1000) }));
    await queue.flush();
    expect(deps.patchReminder).toHaveBeenCalledTimes(1);
    expect(deps.patchReminder.mock.calls[0]![4]).toEqual({ schedule: { value: { ...schedule, time: "11:00" }, editedAt: new Date(LATER.getTime() + 1000).toISOString() } });
  });

  it("sends nothing when a waiting create is deleted", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(reminderCreateChange({ ...ctx, id: "r1", schedule, recipients: ["a"], now: NOW }));
    await queue.enqueue(reminderDeleteChange({ ...ctx, id: "r1" }));
    await queue.flush();
    expect(deps.createReminder).not.toHaveBeenCalled();
    expect(deps.deleteReminder).not.toHaveBeenCalled();
  });

  it("sends a delete", async () => {
    const { queue, deps } = setup();
    await queue.enqueue(reminderDeleteChange({ ...ctx, id: "r1" }));
    await queue.flush();
    expect(deps.deleteReminder).toHaveBeenCalledWith("tok", "p1", "t1", "r1");
  });

  it("reports a permanent refusal to the given handlers", async () => {
    const { queue, deps, handlers } = setup();
    deps.createReminder.mockRejectedValueOnce(new ApiError("reminder_limit_reached", 409));
    await queue.enqueue(reminderCreateChange({ ...ctx, id: "r1", schedule, recipients: ["a"], now: NOW }));
    await queue.flush();
    expect(handlers.onRejected).toHaveBeenCalledTimes(1);
    expect(handlers.onRejected.mock.calls[0]![0].entityId).toBe("r1");
  });
});

describe("reminderRejectedOutcome", () => {
  const change = { changeId: "c", entity: REMINDER_ENTITY, entityId: "r1", kind: "create", data: { ...ctx }, fieldTimes: {}, createdAt: NOW.toISOString() } as Change;

  it("gives the notice and the project to fetch again", () => {
    const out = reminderRejectedOutcome(change, new ApiError("reminder_limit_reached", 409), "Pay rent");
    expect(out).toEqual({ notice: { kind: "create", taskTitle: "Pay rent", reason: "reminderLimit", subject: "reminder" }, refreshProjectId: "p1" });
  });

  it("maps a missing reminder to not_found", () => {
    expect(reminderRejectedOutcome({ ...change, kind: "update" }, new ApiError("not_found", 404), null).notice).toMatchObject({ kind: "update", reason: "not_found", taskTitle: null });
  });
});
