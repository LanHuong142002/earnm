import { describe, expect, it } from "vitest";

import type { Change } from "../../sync/queue";
import type { Task } from "../types";
import { REMINDER_ENTITY } from "../entities";
import { scheduleSource } from "./scheduleSource";
import type { ReminderCache } from "./store";
import type { ServerReminder } from "./types";

const reminder = (id: string, taskId: string): ServerReminder => ({
  id,
  taskId,
  startDate: "2026-11-20",
  time: "09:00",
  timezone: "Asia/Ho_Chi_Minh",
  repeat: "daily",
  weekdays: [],
  endDate: null,
  recipientIds: ["me"],
  createdById: "me",
  changedAt: "2026-11-18T00:00:00.000Z",
});
const cache: ReminderCache = {
  ownerId: "me",
  byProject: {
    p1: { reminders: [reminder("r1", "t1")], remindWith: { t1: [{ author: "Lan", text: "hi" }] } },
    p2: { reminders: [reminder("r2", "t2")], remindWith: {} },
  },
} as ReminderCache;
const task = (id: string, projectId: string) => ({ id, projectId, title: id }) as Task;

describe("scheduleSource", () => {
  it("gathers the reminders, comment lines and tasks of the given projects only", () => {
    const out = scheduleSource({ cache, waiting: [], projectIds: ["p1"], tasksFor: (p) => [task(`t-${p}`, p)] });
    expect(out.reminders.map((r) => r.id)).toEqual(["r1"]);
    expect(out.remindWith).toEqual({ t1: [{ author: "Lan", text: "hi" }] });
    expect(out.tasks.map((t) => t.id)).toEqual(["t-p1"]);
  });
  it("lays waiting reminder changes over the server's list", () => {
    const waiting = [
      { id: "c1", entity: REMINDER_ENTITY, kind: "delete", entityId: "r1", data: { projectId: "p1", taskId: "t1" }, createdAt: "2026-11-18T01:00:00.000Z" },
    ] as unknown as Change[];
    const out = scheduleSource({ cache, waiting, projectIds: ["p1", "p2"], tasksFor: () => [] });
    expect(out.reminders.map((r) => r.id)).toEqual(["r2"]);
  });
  it("is empty for a project with no cached reminders", () => {
    expect(scheduleSource({ cache, waiting: [], projectIds: ["nope"], tasksFor: () => [] })).toEqual({ reminders: [], remindWith: {}, tasks: [] });
  });
});
