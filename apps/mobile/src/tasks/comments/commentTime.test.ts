import { describe, expect, it } from "vitest";

import { formatCommentTime } from "./commentTime";

const dict: Record<string, string> = {
  "tasks.comments.yesterday": "Hôm qua",
  "tasks.weekday.2": "T3",
  "tasks.month.11": "Thg 11",
};
const t = (key: string) => dict[key] ?? key;
const now = new Date(2026, 10, 17, 14, 0); // Tue 17 Nov 2026, local

describe("formatCommentTime", () => {
  it("shows only the time for today, with no leading zero on the hour", () => {
    expect(formatCommentTime(new Date(2026, 10, 17, 8, 30).toISOString(), now, "vi", t)).toBe("8:30");
    expect(formatCommentTime(new Date(2026, 10, 17, 0, 5).toISOString(), now, "vi", t)).toBe("0:05");
  });
  it("says yesterday with the time", () => {
    expect(formatCommentTime(new Date(2026, 10, 16, 20, 14).toISOString(), now, "vi", t)).toBe("Hôm qua 20:14");
  });
  it("shows weekday and date for older comments", () => {
    expect(formatCommentTime(new Date(2026, 10, 10, 9, 0).toISOString(), now, "vi", t)).toBe("T3, 10/11");
    expect(formatCommentTime(new Date(2026, 10, 10, 9, 0).toISOString(), now, "en", t)).toBe("T3, 10 Thg 11");
  });
  it("treats a clock-skewed future time as today", () => {
    expect(formatCommentTime(new Date(2026, 10, 17, 23, 0).toISOString(), now, "vi", t)).toBe("23:00");
  });
  it("returns an empty string for an unreadable time", () => {
    expect(formatCommentTime("nope", now, "vi", t)).toBe("");
  });
});
