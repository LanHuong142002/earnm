import { describe, expect, it } from "vitest";

import { canAddTime, defaultTimeFor, dueChangeError, dueIsInPast, minimumTimeFor } from "./dueRules";

// Local time: 2026-11-12 10:30.
const NOW = new Date(2026, 10, 12, 10, 30, 0, 0);

describe("dueIsInPast", () => {
  it("a day before today is in the past", () => {
    expect(dueIsInPast("2026-11-11", null, NOW)).toBe(true);
  });
  it("today with no time is not in the past", () => {
    expect(dueIsInPast("2026-11-12", null, NOW)).toBe(false);
  });
  it("today at an earlier time is in the past; at the same minute or later it is not", () => {
    expect(dueIsInPast("2026-11-12", "10:29", NOW)).toBe(true);
    expect(dueIsInPast("2026-11-12", "10:30", NOW)).toBe(false);
    expect(dueIsInPast("2026-11-12", "18:00", NOW)).toBe(false);
  });
  it("a later day is never in the past, whatever the time", () => {
    expect(dueIsInPast("2026-11-13", "00:00", NOW)).toBe(false);
  });
});

describe("minimumTimeFor", () => {
  it("is now when the day is today", () => {
    expect(minimumTimeFor("2026-11-12", NOW)).toEqual(NOW);
  });
  it("is nothing for another day", () => {
    expect(minimumTimeFor("2026-11-13", NOW)).toBeUndefined();
  });
});

describe("dueChangeError (only a changed value is checked)", () => {
  const due = (dueDate: string | null, dueTime: string | null = null) => ({ dueDate, dueTime });

  it("lets an already-passed due date be saved unchanged", () => {
    expect(dueChangeError(due("2026-11-01", "08:00"), due("2026-11-01", "08:00"), NOW)).toBeNull();
  });
  it("refuses a newly chosen past day", () => {
    expect(dueChangeError(due(null), due("2026-11-11"), NOW)).toBe("tasks.errors.dueDatePast");
    expect(dueChangeError(due("2026-11-20"), due("2026-11-01"), NOW)).toBe("tasks.errors.dueDatePast");
  });
  it("refuses today with a time earlier than now, whether the day or the time was changed", () => {
    expect(dueChangeError(due(null), due("2026-11-12", "09:00"), NOW)).toBe("tasks.errors.dueTimePast");
    expect(dueChangeError(due("2026-11-12", "18:00"), due("2026-11-12", "09:00"), NOW)).toBe("tasks.errors.dueTimePast");
  });
  it("accepts today at or after now, and today with no time", () => {
    expect(dueChangeError(due(null), due("2026-11-12", "10:30"), NOW)).toBeNull();
    expect(dueChangeError(due(null), due("2026-11-12"), NOW)).toBeNull();
  });
  it("accepts a future day with any time", () => {
    expect(dueChangeError(due(null), due("2026-11-13", "00:00"), NOW)).toBeNull();
  });
  it("accepts clearing the due date", () => {
    expect(dueChangeError(due("2026-11-01", "08:00"), due(null), NOW)).toBeNull();
  });
  it("on an overdue task, clearing only the time is fine, but a new time still on that past day is refused", () => {
    expect(dueChangeError(due("2026-11-01", "08:00"), due("2026-11-01"), NOW)).toBeNull();
    expect(dueChangeError(due("2026-11-01", "08:00"), due("2026-11-01", "09:00"), NOW)).toBe("tasks.errors.dueTimePast");
  });
});

describe("defaultTimeFor (the time a freshly opened clock starts on)", () => {
  it("is noon on a later day", () => {
    expect(defaultTimeFor("2026-11-13", NOW)).toBe("12:00");
  });
  it("is noon today while noon is still ahead", () => {
    expect(defaultTimeFor("2026-11-12", NOW)).toBe("12:00");
  });
  it("is the next whole hour today once noon has passed, so saving a minute later is never past", () => {
    expect(defaultTimeFor("2026-11-12", new Date(2026, 10, 12, 15, 45))).toBe("16:00");
    expect(defaultTimeFor("2026-11-12", new Date(2026, 10, 12, 15, 0))).toBe("16:00");
    expect(defaultTimeFor("2026-11-12", new Date(2026, 10, 12, 12, 1))).toBe("13:00");
  });
  it("is capped at 23:59 late in the day", () => {
    expect(defaultTimeFor("2026-11-12", new Date(2026, 10, 12, 23, 10))).toBe("23:59");
  });
});

describe("canAddTime", () => {
  it("is false for a day before today", () => {
    expect(canAddTime("2026-11-11", NOW)).toBe(false);
  });
  it("is true for today and later days", () => {
    expect(canAddTime("2026-11-12", NOW)).toBe(true);
    expect(canAddTime("2026-11-13", NOW)).toBe(true);
  });
});
