import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import vi from "../../i18n/vi.json";
import { clockLabel, dayLabel, isStopped, reminderLabel, reminderRowModel } from "./labels";
import type { ReminderSchedule } from "./types";

function translator(dict: unknown) {
  return (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = dict;
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    let text = typeof node === "string" ? node : key;
    for (const [k, v] of Object.entries(options ?? {})) text = text.replace(`{{${k}}}`, String(v));
    return text;
  };
}
const tVi = translator(vi);
const tEn = translator(en);

const base: ReminderSchedule = {
  startDate: "2026-11-21",
  time: "08:00",
  timezone: "Asia/Ho_Chi_Minh",
  repeat: "daily",
  weekdays: [],
  endDate: null,
};

describe("reminderLabel", () => {
  it("daily", () => {
    expect(reminderLabel(base, tVi)).toBe("8:00 · Hằng ngày");
    expect(reminderLabel(base, tEn)).toBe("8:00 · Daily");
  });

  it("one-off shows the day, the time and Một lần", () => {
    expect(reminderLabel({ ...base, repeat: "once", time: "15:00" }, tVi)).toBe("T7, 21 Thg 11 · 15:00 · Một lần");
    expect(reminderLabel({ ...base, repeat: "once", time: "15:00" }, tEn)).toBe("Sat, 21 Nov · 15:00 · Once");
  });

  it("weekly lists the weekdays Monday first, Sunday last", () => {
    expect(reminderLabel({ ...base, repeat: "weekly", time: "09:00", weekdays: [5, 1, 3] }, tVi)).toBe("9:00 · T2, T4, T6");
    expect(reminderLabel({ ...base, repeat: "weekly", time: "09:00", weekdays: [0, 6] }, tVi)).toBe("9:00 · T7, CN");
  });

  it("monthly names the day of the month", () => {
    expect(reminderLabel({ ...base, repeat: "monthly" }, tVi)).toBe("8:00 · Ngày 21 hằng tháng");
    expect(reminderLabel({ ...base, repeat: "monthly" }, tEn)).toBe("8:00 · Monthly on day 21");
  });

  it("a repeating reminder with an end date says until when", () => {
    expect(reminderLabel({ ...base, endDate: "2026-11-21" }, tVi)).toBe("8:00 · Hằng ngày · đến 21 Thg 11");
    expect(reminderLabel({ ...base, endDate: "2026-12-05" }, tEn)).toBe("8:00 · Daily · until 5 Dec");
  });
});

describe("clockLabel and dayLabel", () => {
  it("drops the leading zero of the hour only", () => {
    expect(clockLabel("09:05")).toBe("9:05");
    expect(clockLabel("00:00")).toBe("0:00");
    expect(clockLabel("21:30")).toBe("21:30");
  });
  it("names the weekday of the date", () => {
    expect(dayLabel("2026-11-22", tVi)).toBe("CN, 22 Thg 11");
    expect(dayLabel("2026-11-20", tVi)).toBe("T6, 20 Thg 11");
  });
});

describe("isStopped / reminderRowModel (AC24)", () => {
  const now = new Date("2026-11-21T10:00:00Z"); // 17:00 in Ho Chi Minh City

  it("a repeating reminder without an end date is never stopped", () => {
    expect(isStopped(base, false, now)).toBe(false);
  });
  it("a done task stops every reminder", () => {
    expect(isStopped(base, true, now)).toBe(true);
  });
  it("a one-off is stopped once its moment has passed, not before", () => {
    const once = { ...base, repeat: "once" as const, time: "15:00" }; // 08:00Z, already past
    expect(isStopped(once, false, now)).toBe(true);
    expect(isStopped({ ...once, time: "18:00" }, false, now)).toBe(false);
  });
  it("a reminder is stopped after its end date", () => {
    expect(isStopped({ ...base, endDate: "2026-11-20" }, false, now)).toBe(true);
    expect(isStopped({ ...base, endDate: "2026-11-22" }, false, now)).toBe(false);
    expect(isStopped({ ...base, endDate: "2026-11-21", time: "23:00" }, false, now)).toBe(false);
    expect(isStopped({ ...base, endDate: "2026-11-21", time: "09:00" }, false, now)).toBe(true);
  });
  it("the row model carries text, stopped and waiting", () => {
    const row = reminderRowModel({ ...base, repeat: "once", time: "15:00", state: "waiting" }, false, now, tVi);
    expect(row).toEqual({ text: "T7, 21 Thg 11 · 15:00 · Một lần", stopped: true, waiting: true });
    expect(reminderRowModel({ ...base, state: "synced" }, false, now, tVi)).toMatchObject({ stopped: false, waiting: false });
  });
});
