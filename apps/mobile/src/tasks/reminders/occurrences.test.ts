import { describe, expect, it } from "vitest";
import { isFutureOnce, occurrencesBetween, type ReminderRule } from "./occurrences.js";

const HCM = "Asia/Ho_Chi_Minh"; // UTC+7, no DST
const NY = "America/New_York"; // DST: 8 Mar 2026 and 1 Nov 2026

function rule(patch: Partial<ReminderRule> = {}): ReminderRule {
  return {
    startDate: "2026-11-18",
    time: "09:00",
    timezone: HCM,
    repeat: "once",
    weekdays: [],
    endDate: null,
    ...patch,
  };
}

const iso = (ds: Date[]) => ds.map((d) => d.toISOString());
const between = (r: ReminderRule, from: string, to: string) =>
  iso(occurrencesBetween(r, new Date(from), new Date(to)));

describe("occurrencesBetween", () => {
  it("once: fires on the start date only, in the stored zone", () => {
    expect(between(rule(), "2026-11-01T00:00:00Z", "2026-12-31T00:00:00Z")).toEqual([
      "2026-11-18T02:00:00.000Z",
    ]);
  });

  it("daily: every day from the start date", () => {
    expect(between(rule({ repeat: "daily" }), "2026-11-17T00:00:00Z", "2026-11-20T23:59:59Z")).toEqual([
      "2026-11-18T02:00:00.000Z",
      "2026-11-19T02:00:00.000Z",
      "2026-11-20T02:00:00.000Z",
    ]);
  });

  it("weekly: only the chosen weekdays on or after the start date", () => {
    // 18 Nov 2026 is a Wednesday. Monday (1) and Wednesday (3).
    const r = rule({ repeat: "weekly", weekdays: [1, 3] });
    expect(between(r, "2026-11-01T00:00:00Z", "2026-11-30T00:00:00Z")).toEqual([
      "2026-11-18T02:00:00.000Z", // Wed
      "2026-11-23T02:00:00.000Z", // Mon
      "2026-11-25T02:00:00.000Z", // Wed
    ]);
  });

  it("weekly: Sunday is 0 and Saturday is 6", () => {
    const r = rule({ repeat: "weekly", weekdays: [0, 6], startDate: "2026-11-18" });
    expect(between(r, "2026-11-18T00:00:00Z", "2026-11-23T00:00:00Z")).toEqual([
      "2026-11-21T02:00:00.000Z", // Sat
      "2026-11-22T02:00:00.000Z", // Sun
    ]);
  });

  it("monthly: the start day each month", () => {
    const r = rule({ repeat: "monthly", startDate: "2026-01-15" });
    expect(between(r, "2026-01-01T00:00:00Z", "2026-03-31T00:00:00Z")).toEqual([
      "2026-01-15T02:00:00.000Z",
      "2026-02-15T02:00:00.000Z",
      "2026-03-15T02:00:00.000Z",
    ]);
  });

  it("monthly on the 31st falls to the last day in February and April", () => {
    const r = rule({ repeat: "monthly", startDate: "2026-01-31" });
    expect(between(r, "2026-01-01T00:00:00Z", "2026-05-31T23:00:00Z")).toEqual([
      "2026-01-31T02:00:00.000Z",
      "2026-02-28T02:00:00.000Z",
      "2026-03-31T02:00:00.000Z",
      "2026-04-30T02:00:00.000Z",
      "2026-05-31T02:00:00.000Z",
    ]);
  });

  it("monthly on the 31st uses 29 February in a leap year", () => {
    const r = rule({ repeat: "monthly", startDate: "2027-12-31" });
    expect(between(r, "2028-02-01T00:00:00Z", "2028-02-29T23:00:00Z")).toEqual([
      "2028-02-29T02:00:00.000Z",
    ]);
  });

  it("the end date is inclusive and nothing fires after it", () => {
    const r = rule({ repeat: "daily", endDate: "2026-11-20" });
    expect(between(r, "2026-11-18T00:00:00Z", "2026-11-30T00:00:00Z")).toEqual([
      "2026-11-18T02:00:00.000Z",
      "2026-11-19T02:00:00.000Z",
      "2026-11-20T02:00:00.000Z",
    ]);
  });

  it("the end date counts in the stored zone, not UTC", () => {
    // 23:30 in Ho Chi Minh on the end date is 16:30Z the same day.
    const r = rule({ repeat: "daily", time: "23:30", endDate: "2026-11-19" });
    expect(between(r, "2026-11-18T00:00:00Z", "2026-11-30T00:00:00Z")).toEqual([
      "2026-11-18T16:30:00.000Z",
      "2026-11-19T16:30:00.000Z",
    ]);
  });

  it("computes in the stored zone: a late-evening New York time is the next UTC day", () => {
    const r = rule({ timezone: NY, time: "21:00", startDate: "2026-11-18" });
    expect(between(r, "2026-11-18T00:00:00Z", "2026-11-20T00:00:00Z")).toEqual([
      "2026-11-19T02:00:00.000Z",
    ]);
  });

  it("America/New_York keeps 09:00 local across the November DST change", () => {
    const r = rule({ timezone: NY, repeat: "daily", startDate: "2026-10-30" });
    expect(between(r, "2026-10-30T00:00:00Z", "2026-11-02T23:59:59Z")).toEqual([
      "2026-10-30T13:00:00.000Z", // EDT, UTC-4
      "2026-10-31T13:00:00.000Z",
      "2026-11-01T14:00:00.000Z", // EST, UTC-5 after the change
      "2026-11-02T14:00:00.000Z",
    ]);
  });

  it("America/New_York keeps 09:00 local across the March DST change", () => {
    const r = rule({ timezone: NY, repeat: "daily", startDate: "2026-03-07" });
    expect(between(r, "2026-03-07T00:00:00Z", "2026-03-09T23:59:59Z")).toEqual([
      "2026-03-07T14:00:00.000Z", // EST
      "2026-03-08T13:00:00.000Z", // EDT from 02:00
      "2026-03-09T13:00:00.000Z",
    ]);
  });

  it("Asia/Ho_Chi_Minh has no DST: the offset never moves", () => {
    const r = rule({ repeat: "daily", startDate: "2026-03-07" });
    const all = between(r, "2026-03-07T00:00:00Z", "2026-11-30T00:00:00Z");
    expect(all.every((s) => s.endsWith("T02:00:00.000Z"))).toBe(true);
  });

  it("is empty for a range before the start date", () => {
    expect(between(rule({ repeat: "daily" }), "2026-11-01T00:00:00Z", "2026-11-17T00:00:00Z")).toEqual([]);
  });

  it("is empty for a range after the end date", () => {
    const r = rule({ repeat: "daily", endDate: "2026-11-20" });
    expect(between(r, "2026-11-21T00:00:00Z", "2026-12-31T00:00:00Z")).toEqual([]);
  });

  it("includes both ends of the range", () => {
    const r = rule();
    expect(between(r, "2026-11-18T02:00:00Z", "2026-11-18T02:00:00Z")).toEqual(["2026-11-18T02:00:00.000Z"]);
  });
});

describe("isFutureOnce", () => {
  it("is true for a one-off still ahead and false once it has passed", () => {
    const r = rule({ startDate: "2026-11-18", time: "09:00" }); // 02:00Z
    expect(isFutureOnce(r, new Date("2026-11-18T01:59:00Z"))).toBe(true);
    expect(isFutureOnce(r, new Date("2026-11-18T02:00:00Z"))).toBe(false);
    expect(isFutureOnce(r, new Date("2026-11-19T00:00:00Z"))).toBe(false);
  });

  it("is always true for a repeating rule", () => {
    expect(isFutureOnce(rule({ repeat: "daily", startDate: "2020-01-01" }), new Date("2026-11-18T00:00:00Z"))).toBe(
      true,
    );
  });
});
