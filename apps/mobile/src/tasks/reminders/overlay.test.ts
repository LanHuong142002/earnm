import { describe, expect, it } from "vitest";

import type { Change } from "../../sync/queue";
import { REMINDER_ENTITY } from "../entities";
import { applyReminderOverlay } from "./overlay";
import type { ReminderSchedule, ServerReminder } from "./types";

const schedule: ReminderSchedule = {
  startDate: "2026-11-20",
  time: "09:00",
  timezone: "Asia/Ho_Chi_Minh",
  repeat: "daily",
  weekdays: [],
  endDate: null,
};

const server = (id: string, patch: Partial<ServerReminder> = {}): ServerReminder => ({
  id,
  taskId: "t1",
  ...schedule,
  recipientIds: ["me"],
  createdById: "me",
  changedAt: "2026-11-10T00:00:00.000Z",
  ...patch,
});

let n = 0;
function change(kind: Change["kind"], entityId: string, data: Record<string, unknown>, patch: Partial<Change> = {}): Change {
  n += 1;
  return {
    changeId: `c${n}`,
    entity: REMINDER_ENTITY,
    entityId,
    kind,
    data: { projectId: "p1", taskId: "t1", ...data },
    fieldTimes: {},
    createdAt: "2026-11-12T09:00:00.000Z",
    ...patch,
  };
}

describe("applyReminderOverlay", () => {
  it("shows server reminders as synced", () => {
    expect(applyReminderOverlay([server("r1")], [])).toEqual([{ ...server("r1"), state: "synced" }]);
  });

  it("a queued create shows as a waiting reminder (AC28)", () => {
    const out = applyReminderOverlay([], [change("create", "r9", { schedule, recipients: ["a", "b"] })]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "r9", taskId: "t1", state: "waiting", recipientIds: ["a", "b"], repeat: "daily", time: "09:00" });
  });

  it("ignores a queued create the server already has", () => {
    const out = applyReminderOverlay([server("r1")], [change("create", "r1", { schedule: { ...schedule, time: "10:00" }, recipients: ["x"] })]);
    expect(out).toEqual([{ ...server("r1"), state: "synced" }]);
  });

  it("a queued schedule patch shows its new values and marks the row waiting", () => {
    const next = { ...schedule, time: "18:30", repeat: "weekly" as const, weekdays: [1, 3] };
    const out = applyReminderOverlay([server("r1")], [change("update", "r1", { schedule: next })]);
    expect(out[0]).toMatchObject({ time: "18:30", repeat: "weekly", weekdays: [1, 3], recipientIds: ["me"], state: "waiting" });
  });

  it("a queued recipients patch changes only the recipients", () => {
    const out = applyReminderOverlay([server("r1")], [change("update", "r1", { recipients: ["a", "b"] })]);
    expect(out[0]).toMatchObject({ recipientIds: ["a", "b"], time: "09:00", state: "waiting" });
  });

  it("a queued delete hides the reminder", () => {
    expect(applyReminderOverlay([server("r1"), server("r2")], [change("delete", "r1", {})]).map((r) => r.id)).toEqual(["r2"]);
  });

  it("ignores a patch for a reminder that is not there, and other entities", () => {
    const other = change("update", "r1", { recipients: ["x"] }, { entity: "comment" });
    expect(applyReminderOverlay([server("r2")], [change("update", "r1", { recipients: ["x"] }), other])).toEqual([{ ...server("r2"), state: "synced" }]);
  });

  it("only looks at changes of the given project when asked", () => {
    const out = applyReminderOverlay([server("r1")], [change("delete", "r1", { projectId: "p2" })], "p1");
    expect(out.map((r) => r.id)).toEqual(["r1"]);
  });
});
