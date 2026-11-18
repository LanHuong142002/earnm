import { describe, expect, it } from "vitest";

import type { Task } from "../types";
import {
  changesFromForm,
  defaultReminderForm,
  formFromReminder,
  scheduleFromForm,
  setRepeat,
  validateReminderForm,
  type ReminderForm,
} from "./formState";

const TZ = "Asia/Ho_Chi_Minh";
// Thu 12 Nov 2026, 10:00 local time of the machine running the tests.
const now = new Date(2026, 10, 12, 10, 0, 0);

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "t1",
    projectId: "p1",
    title: "T",
    description: "",
    status: "todo",
    dueDate: null,
    dueTime: null,
    assignees: [],
    createdById: "creator",
    createdAt: "2026-11-01T00:00:00.000Z",
    labelIds: [],
    checklists: [],
    ...patch,
  };
}

const form = (patch: Partial<ReminderForm> = {}): ReminderForm => ({
  startDate: "2026-11-20",
  time: "09:00",
  timezone: TZ,
  repeat: "once",
  weekdays: [],
  endDate: null,
  recipientIds: ["me"],
  ...patch,
});

describe("defaultReminderForm (R4, R5)", () => {
  it("goes to the assignees, or to the creator when there are none", () => {
    const withAssignees = task({ assignees: [{ id: "a", displayName: "A" }, { id: "b", displayName: "B" }] });
    expect(defaultReminderForm({ task: withAssignees, meId: "me", now, timezone: TZ }).recipientIds).toEqual(["a", "b"]);
    expect(defaultReminderForm({ task: task(), meId: "me", now, timezone: TZ }).recipientIds).toEqual(["creator"]);
  });

  it("falls back to me when the task has no assignee and no creator", () => {
    expect(defaultReminderForm({ task: task({ createdById: null }), meId: "me", now, timezone: TZ }).recipientIds).toEqual(["me"]);
  });

  it("is the due date at the due time", () => {
    const f = defaultReminderForm({ task: task({ dueDate: "2026-11-20", dueTime: "15:30" }), meId: "me", now, timezone: TZ });
    expect(f).toMatchObject({ startDate: "2026-11-20", time: "15:30", repeat: "once", weekdays: [], endDate: null, timezone: TZ });
  });

  it("is 9:00 on the due date when there is a date but no time", () => {
    const f = defaultReminderForm({ task: task({ dueDate: "2026-11-20" }), meId: "me", now, timezone: TZ });
    expect(f).toMatchObject({ startDate: "2026-11-20", time: "09:00" });
  });

  it("is 9:00 tomorrow when the task has no due date", () => {
    const f = defaultReminderForm({ task: task(), meId: "me", now, timezone: TZ });
    expect(f).toMatchObject({ startDate: "2026-11-13", time: "09:00" });
  });
});

describe("validateReminderForm (AC27)", () => {
  it("accepts a future one-off with a recipient", () => {
    expect(validateReminderForm(form(), now)).toEqual({});
  });

  it("refuses a one-off that is not in the future", () => {
    expect(validateReminderForm(form({ startDate: "2026-11-01" }), now)).toEqual({ date: "tasks.reminders.errors.past" });
  });

  it("does not refuse a past start for a repeating reminder", () => {
    expect(validateReminderForm(form({ repeat: "daily", startDate: "2026-11-01" }), now)).toEqual({});
  });

  it("needs at least one recipient, and at most 20", () => {
    expect(validateReminderForm(form({ recipientIds: [] }), now)).toEqual({ recipients: "tasks.reminders.errors.recipients" });
    const many = Array.from({ length: 21 }, (_, i) => `u${i}`);
    expect(validateReminderForm(form({ recipientIds: many }), now)).toEqual({ recipients: "tasks.reminders.errors.tooManyRecipients" });
    expect(validateReminderForm(form({ recipientIds: many.slice(0, 20) }), now)).toEqual({});
  });

  it("needs a weekday for a weekly reminder", () => {
    expect(validateReminderForm(form({ repeat: "weekly", weekdays: [] }), now)).toEqual({ weekdays: "tasks.reminders.errors.weekdays" });
    expect(validateReminderForm(form({ repeat: "weekly", weekdays: [2] }), now)).toEqual({});
  });

  it("refuses an end date before the start date, but accepts the same day", () => {
    expect(validateReminderForm(form({ repeat: "daily", endDate: "2026-11-19" }), now)).toEqual({ endDate: "tasks.reminders.errors.endBeforeStart" });
    expect(validateReminderForm(form({ repeat: "daily", endDate: "2026-11-20" }), now)).toEqual({});
  });

  it("ignores the end date and weekdays of a kind of reminder that does not use them", () => {
    expect(validateReminderForm(form({ repeat: "once", endDate: "2026-01-01", weekdays: [] }), now)).toEqual({});
    expect(validateReminderForm(form({ repeat: "daily", weekdays: [] }), now)).toEqual({});
  });

  it("reports every problem at once", () => {
    const errors = validateReminderForm(form({ repeat: "weekly", weekdays: [], endDate: "2026-11-01", recipientIds: [] }), now);
    expect(Object.keys(errors).sort()).toEqual(["endDate", "recipients", "weekdays"]);
  });
});

describe("scheduleFromForm and setRepeat", () => {
  it("clears what the kind of reminder does not use", () => {
    expect(scheduleFromForm(form({ repeat: "once", weekdays: [1], endDate: "2026-12-01" }))).toEqual({
      startDate: "2026-11-20",
      time: "09:00",
      timezone: TZ,
      repeat: "once",
      weekdays: [],
      endDate: null,
    });
    expect(scheduleFromForm(form({ repeat: "daily", weekdays: [1], endDate: "2026-12-01" }))).toMatchObject({ weekdays: [], endDate: "2026-12-01" });
    expect(scheduleFromForm(form({ repeat: "weekly", weekdays: [5, 1, 5] }))).toMatchObject({ weekdays: [1, 5] });
  });

  it("choosing weekly picks the weekday of the start date", () => {
    // 2026-11-20 is a Friday.
    expect(setRepeat(form(), "weekly").weekdays).toEqual([5]);
    expect(setRepeat(form({ weekdays: [2] }), "weekly").weekdays).toEqual([2]);
  });
});

describe("changesFromForm", () => {
  const opened = form({ repeat: "daily", recipientIds: ["a", "b"] });

  it("is empty when nothing changed", () => {
    expect(changesFromForm(opened, form({ repeat: "daily", recipientIds: ["b", "a"] }))).toEqual({});
  });

  it("sends only the schedule when only it changed, and only the recipients when only they did", () => {
    expect(changesFromForm(opened, { ...opened, time: "10:00" })).toEqual({ schedule: scheduleFromForm({ ...opened, time: "10:00" }) });
    expect(changesFromForm(opened, { ...opened, recipientIds: ["a"] })).toEqual({ recipients: ["a"] });
  });

  it("round-trips a reminder through the form", () => {
    const reminder = { id: "r", taskId: "t1", startDate: "2026-11-20", time: "09:00", timezone: TZ, repeat: "weekly" as const, weekdays: [1, 3], endDate: null, recipientIds: ["a"], createdById: "a", changedAt: "x" };
    expect(scheduleFromForm(formFromReminder(reminder))).toEqual({ startDate: "2026-11-20", time: "09:00", timezone: TZ, repeat: "weekly", weekdays: [1, 3], endDate: null });
    expect(formFromReminder(reminder).recipientIds).toEqual(["a"]);
  });
});
