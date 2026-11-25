import { describe, expect, it } from "vitest";

import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import { NOTIFICATION_TYPES, type NotificationSettings } from "./api";
import { applyChange, isMuted, revertChange, saveChange, shouldApplyLoad, type SettingsChange } from "./settingsLogic";

const start = (): NotificationSettings => ({
  types: { assigned: true, comment: true, done: true, idea: true, member_joined: true },
  mutedProjectIds: ["p9"],
});

describe("notification settings changes (AC27)", () => {
  it("turns a type off and a project's mute on, at once", () => {
    const off = applyChange(start(), { kind: "type", type: "comment", enabled: false });
    expect(off.types.comment).toBe(false);
    expect(off.types.assigned).toBe(true);
    const muted = applyChange(start(), { kind: "mute", projectId: "p1", muted: true });
    expect(muted.mutedProjectIds).toEqual(["p9", "p1"]);
    expect(isMuted(muted, "p1")).toBe(true);
    expect(applyChange(muted, { kind: "mute", projectId: "p1", muted: false }).mutedProjectIds).toEqual(["p9"]);
    expect(isMuted(null, "p1")).toBe(false);
  });

  it("puts one switch back without touching another changed meanwhile", () => {
    const change: SettingsChange = { kind: "type", type: "idea", enabled: false };
    const shown = applyChange(applyChange(start(), change), { kind: "type", type: "done", enabled: false });
    const back = revertChange(shown, change);
    expect(back.types.idea).toBe(true);
    expect(back.types.done).toBe(false);
  });

  it("keeps the new value when the save works", async () => {
    let shown = start();
    const change: SettingsChange = { kind: "type", type: "assigned", enabled: false };
    const out = await saveChange(
      () => shown,
      (s) => (shown = s),
      async () => ({}),
      change,
    );
    expect(out.failed).toBe(false);
    expect(shown.types.assigned).toBe(false);
  });

  it("reverts the switch and reports a failure when the save fails", async () => {
    let shown = start();
    const seen: boolean[] = [];
    const change: SettingsChange = { kind: "mute", projectId: "p1", muted: true };
    const out = await saveChange(
      () => shown,
      (s) => {
        shown = s;
        seen.push(isMuted(s, "p1"));
      },
      async () => {
        throw new Error("network");
      },
      change,
    );
    expect(out.failed).toBe(true);
    expect(seen).toEqual([true, false]);
    expect(shown).toEqual(start());
  });

  it("has a label for every type in both languages, and the save-failed line", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(vi.notifications.types[type]).toBeTruthy();
      expect(en.notifications.types[type]).toBeTruthy();
    }
    expect(vi.notifications.saveFailed).toBe("Không lưu được. Đã trả lại như cũ.");
    expect(en.notifications.saveFailed).toBe("Couldn't save. Switched back.");
  });
});

describe("a slow load next to a switch flip", () => {
  it("is ignored when a change was made after the load started", () => {
    expect(shouldApplyLoad(0, 0)).toBe(true);
    expect(shouldApplyLoad(0, 1)).toBe(false);
    expect(shouldApplyLoad(2, 2)).toBe(true);
  });
});
