import { describe, expect, it, vi } from "vitest";

import { ApiError } from "../../lib/api";
import { createQueue, type Queue } from "../../sync/queue";
import { createMemoryStore } from "../../sync/storage";
import type { TaskRejectedNotice } from "../outcomes";
import { createTaskSyncCycle } from "../syncCycle";
import type { Task } from "../types";
import { registerReminderEntity, reminderCreateChange } from "./sync";
import type { ProjectReminders, ReminderSchedule } from "./types";

const schedule: ReminderSchedule = { startDate: "2026-11-20", time: "09:00", timezone: "Asia/Ho_Chi_Minh", repeat: "daily", weekdays: [], endDate: null };
const task = { id: "t1", projectId: "p1", title: "Pay rent" } as Task;
const served: ProjectReminders = { reminders: [], remindWith: { t1: [{ author: "A", text: "hi" }] } };

function setup(options: { reminders?: unknown | ApiError; createError?: ApiError } = {}) {
  let notice: TaskRejectedNotice | null = null;
  const committed: [string, ProjectReminders | null][] = [];
  const listTasks = vi.fn(async () => [task]);
  const listReminders = vi.fn(async () => {
    if (options.reminders instanceof ApiError) throw options.reminders;
    return options.reminders ?? served;
  });
  const createReminder = vi.fn(async () => {
    if (options.createError) throw options.createError;
    return {};
  });
  let queue!: Queue;
  const cycle = createTaskSyncCycle({
    getQueue: () => queue,
    getToken: async () => "tok",
    listTasks,
    listLabels: async () => [],
    getLabels: () => [],
    commitLabels: async () => undefined,
    getTasks: () => [task],
    commit: async () => undefined,
    listReminders,
    commitReminders: async (projectId, data) => {
      committed.push([projectId, data]);
    },
    setNotice: (n) => {
      notice = n;
    },
    getGeneration: () => 0,
    isWiped: () => false,
    settleMutations: async () => queue.waiting(),
    onNotSignedIn: vi.fn(),
  });
  queue = createQueue({ store: createMemoryStore(), getToken: async () => "tok", onApplied: () => {}, onRejected: () => {}, onSignedOut: () => {} });
  registerReminderEntity(queue, cycle.handlers, { createReminder, patchReminder: vi.fn(), deleteReminder: vi.fn() } as never);
  return { queue, cycle, committed, listReminders, getNotice: () => notice };
}

describe("reminders in the task sync cycle", () => {
  it("fetches the project's reminders on refresh and commits them as the server sent them", async () => {
    const { cycle, committed } = setup();
    expect(await cycle.refresh("p1")).toBe("ok");
    expect(committed).toEqual([["p1", served]]);
  });

  it("keeps the cached reminders, and still refreshes the tasks, when the reminders cannot be fetched or are malformed", async () => {
    for (const reminders of [new ApiError("network"), { nonsense: true }]) {
      const { cycle, committed } = setup({ reminders });
      expect(await cycle.refresh("p1")).toBe("ok");
      expect(committed).toEqual([]);
    }
  });

  it("a project that is gone loses its reminders too", async () => {
    const { cycle, committed } = setup({ reminders: new ApiError("not_found", 404) });
    expect(await cycle.refresh("p1")).toBe("gone");
    expect(committed).toEqual([["p1", null]]);
  });

  it("a refused reminder change sets the task notice with the task title and fetches the project again", async () => {
    const { queue, cycle, committed, getNotice } = setup({ createError: new ApiError("reminder_limit_reached", 409) });
    await queue.enqueue(reminderCreateChange({ projectId: "p1", taskId: "t1", id: "r1", schedule, recipients: ["me"], now: new Date() }));
    await queue.flush();
    await cycle.idle();
    expect(getNotice()).toEqual({ kind: "create", taskTitle: "Pay rent", reason: "reminderLimit", subject: "reminder" });
    await cycle.refreshPending();
    expect(committed).toHaveLength(1);
  });

  it("a saved reminder change fetches the project again so the server's reminder shows", async () => {
    const { queue, cycle, committed } = setup();
    await queue.enqueue(reminderCreateChange({ projectId: "p1", taskId: "t1", id: "r1", schedule, recipients: ["me"], now: new Date() }));
    await queue.flush();
    await cycle.idle();
    await cycle.refreshPending();
    expect(committed).toHaveLength(1);
  });
});
