import { describe, expect, it } from "vitest";

import { reminderRowLines } from "./rowLines";
import type { Reminder } from "./types";

const t = (key: string, o?: Record<string, unknown>) => {
  const words: Record<string, string> = {
    "tasks.reminders.once": "Một lần",
    "tasks.reminders.daily": "Hằng ngày",
    "tasks.reminders.until": `đến ${o?.date}`,
    "tasks.month.11": "Thg 11",
    "tasks.month.12": "Thg 12",
  };
  return words[key] ?? key;
};

const base: Reminder = {
  id: "r1",
  taskId: "t1",
  startDate: "2026-11-18",
  time: "08:00",
  timezone: "Asia/Ho_Chi_Minh",
  repeat: "daily",
  weekdays: [],
  endDate: "2026-12-21",
  recipientIds: ["u1", "u2"],
  createdById: "u1",
  changedAt: "2026-11-18T00:00:00.000Z",
  state: "synced",
};
const names = { u1: "Lan", u2: "Huy" };
const now = new Date("2026-11-18T01:00:00Z");

describe("reminderRowLines", () => {
  it("puts the time and repeat on the first line and the people and end date on the second (R22)", () => {
    const row = reminderRowLines(base, names, false, now, t);
    expect(row.title).toBe("8:00 · Hằng ngày");
    expect(row.subtitle).toBe("Lan, Huy · đến 21 Thg 12");
    expect(row.stopped).toBe(false);
    expect(row.waiting).toBe(false);
  });
  it("leaves out the end date when there is none", () => {
    expect(reminderRowLines({ ...base, endDate: null }, names, false, now, t).subtitle).toBe("Lan, Huy");
  });
  it("marks every row stopped when the task is done (R24, AC24)", () => {
    expect(reminderRowLines(base, names, true, now, t).stopped).toBe(true);
  });
  it("marks a reminder that is still queued as waiting", () => {
    expect(reminderRowLines({ ...base, state: "waiting" }, names, false, now, t).waiting).toBe(true);
  });
  it("skips recipients whose name is not known", () => {
    expect(reminderRowLines({ ...base, recipientIds: ["u1", "zz"], endDate: null }, names, false, now, t).subtitle).toBe("Lan");
  });
});
