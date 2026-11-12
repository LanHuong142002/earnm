import { describe, expect, it } from "vitest";

import {
  clearDay,
  clearTime,
  dateToDay,
  dateToTime,
  dayToDate,
  editFromForm,
  emptyForm,
  formFromTask,
  inputFromForm,
  setDay,
  setTime,
  timeToDate,
} from "./formState";
import { makeTask } from "./fixtures";
import { validateTaskInput } from "./validate";

describe("emptyForm and inputFromForm", () => {
  it("starts with a todo status, no due date and no people", () => {
    expect(emptyForm()).toEqual({
      title: "",
      description: "",
      status: "todo",
      dueDate: null,
      dueTime: null,
      assigneeIds: [],
    });
  });
  it("a title-only form is a valid task (R27)", () => {
    const input = inputFromForm({ ...emptyForm(), title: "Buy flour" });
    expect(validateTaskInput(input).ok).toBe(true);
  });
  it("an empty title is refused with the field message", () => {
    expect(validateTaskInput(inputFromForm(emptyForm()))).toMatchObject({
      ok: false,
      errors: { title: "tasks.errors.titleRequired" },
    });
  });
});

describe("formFromTask", () => {
  it("copies the editable fields and the assignee ids", () => {
    const task = makeTask({
      title: "A",
      description: "B",
      status: "doing",
      dueDate: "2026-11-14",
      dueTime: "09:30",
      assignees: [{ id: "u2", displayName: "Binh" }],
    });
    expect(formFromTask(task)).toEqual({
      title: "A",
      description: "B",
      status: "doing",
      dueDate: "2026-11-14",
      dueTime: "09:30",
      assigneeIds: ["u2"],
    });
  });
});

describe("editFromForm", () => {
  const opened = formFromTask(makeTask({ title: "A", dueDate: "2026-11-14", dueTime: "09:30" }));
  it("sends nothing when nothing changed", () => {
    expect(editFromForm(opened, opened)).toEqual({});
  });
  it("sends only the fields that changed", () => {
    expect(editFromForm(opened, { ...opened, title: "B", status: "done" })).toEqual({ title: "B", status: "done" });
  });
  it("clearing the day sends both as null", () => {
    expect(editFromForm(opened, clearDay(opened))).toEqual({ dueDate: null, dueTime: null });
  });
  it("clearing only the time sends only the time", () => {
    expect(editFromForm(opened, clearTime(opened))).toEqual({ dueTime: null });
  });
  it("sends assignees only when the set changed", () => {
    expect(editFromForm(opened, { ...opened, assigneeIds: ["x"] })).toEqual({ assigneeIds: ["x"] });
    const two = { ...opened, assigneeIds: ["a", "b"] };
    expect(editFromForm(two, { ...two, assigneeIds: ["b", "a"] })).toEqual({});
    expect(editFromForm(two, { ...two, assigneeIds: [] })).toEqual({ assigneeIds: [] });
  });
});

describe("due helpers", () => {
  const form = emptyForm();
  it("setDay sets the day and keeps the time", () => {
    expect(setDay({ ...form, dueDate: "2026-01-01", dueTime: "08:00" }, "2026-02-03")).toMatchObject({
      dueDate: "2026-02-03",
      dueTime: "08:00",
    });
  });
  it("clearing the day clears the time", () => {
    expect(clearDay({ ...form, dueDate: "2026-01-01", dueTime: "08:00" })).toMatchObject({
      dueDate: null,
      dueTime: null,
    });
  });
  it("setTime without a day is ignored", () => {
    expect(setTime(form, "08:00")).toEqual(form);
  });
  it("setTime with a day sets it; clearTime removes it", () => {
    const withDay = setDay(form, "2026-02-03");
    expect(setTime(withDay, "08:05").dueTime).toBe("08:05");
    expect(clearTime(setTime(withDay, "08:05")).dueTime).toBeNull();
  });
});

describe("date conversions use the phone's local calendar", () => {
  it("round-trips a day, with single digits padded", () => {
    expect(dateToDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    const d = dayToDate("2026-01-05");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 0, 5]);
  });
  it("round-trips a time of day", () => {
    expect(dateToTime(new Date(2026, 0, 5, 7, 4))).toBe("07:04");
    const d = timeToDate("2026-01-05", "07:04");
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([5, 7, 4]);
  });
  it("timeToDate without a time is noon, away from day edges", () => {
    expect(timeToDate("2026-01-05", null).getHours()).toBe(12);
  });
});
