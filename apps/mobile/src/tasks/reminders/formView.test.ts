import { describe, expect, it } from "vitest";

import { defaultEndDate, toggleRecipient, toggleWeekday, visibleErrors } from "./formView";
import type { ReminderForm } from "./formState";

const now = new Date("2026-11-18T03:00:00Z");
const form: ReminderForm = {
  startDate: "2026-11-20",
  time: "09:00",
  timezone: "Asia/Ho_Chi_Minh",
  repeat: "once",
  weekdays: [],
  endDate: null,
  recipientIds: ["u1"],
};

describe("visibleErrors", () => {
  it("is empty for a good form", () => {
    expect(visibleErrors(null, form, now)).toEqual({});
  });
  it("flags a one-off in the past and no recipients (AC27)", () => {
    const bad = { ...form, startDate: "2026-11-01", recipientIds: [] };
    expect(visibleErrors(null, bad, now)).toEqual({ date: "tasks.reminders.errors.past", recipients: "tasks.reminders.errors.recipients" });
  });
  it("ignores a past date on an edit that did not change the schedule", () => {
    const past = { ...form, startDate: "2026-11-01" };
    expect(visibleErrors(past, { ...past, recipientIds: ["u1", "u2"] }, now)).toEqual({});
  });
  it("still flags a past date once the schedule is changed on an edit", () => {
    expect(visibleErrors(form, { ...form, startDate: "2026-11-01" }, now).date).toBe("tasks.reminders.errors.past");
  });
});

describe("defaultEndDate", () => {
  it("is a week after the start, across month and year ends", () => {
    expect(defaultEndDate("2026-11-20")).toBe("2026-11-27");
    expect(defaultEndDate("2026-12-28")).toBe("2027-01-04");
  });
});

describe("toggles", () => {
  it("adds and removes a recipient", () => {
    expect(toggleRecipient(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleRecipient(["a", "b"], "a")).toEqual(["b"]);
  });
  it("keeps weekdays sorted", () => {
    expect(toggleWeekday([1, 5], 3)).toEqual([1, 3, 5]);
    expect(toggleWeekday([1, 3, 5], 3)).toEqual([1, 5]);
  });
});
