import { describe, expect, it } from "vitest";

import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import { bellState } from "./bell";

describe("bellState (AC32)", () => {
  it("shows the dot and says so only while something is unread", () => {
    expect(bellState(true)).toEqual({ showDot: true, labelKey: "activity.bell.labelUnread" });
    expect(bellState(false)).toEqual({ showDot: false, labelKey: "activity.bell.label" });
  });

  it("names the bell in both languages, with the unread note", () => {
    expect(vi.activity.bell).toEqual({ label: "Hoạt động", labelUnread: "Hoạt động, có mục chưa đọc" });
    expect(en.activity.bell).toEqual({ label: "Activity", labelUnread: "Activity, unread items" });
  });
});
