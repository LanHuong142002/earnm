import { describe, expect, it } from "vitest";

import en from "../i18n/en.json";
import vi from "../i18n/vi.json";
import { tapDestination, tapFound } from "../tasks/reminders/notificationLogic";
import type { ActivityItem, ActivityType } from "./api";
import { activityIcon, groupByDay, metaLine, relativeTime, rowTarget, rowText, sectionsOf, type Translate } from "./format";

/** A translate function over the real language files, with {{name}} filled in. */
function translator(tree: unknown): Translate {
  return (key, options = {}) => {
    const text = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
    if (typeof text !== "string") throw new Error(`missing key ${key}`);
    return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name]));
  };
}
const tVi = translator(vi);
const tEn = translator(en);

// Local-time dates, so the tests hold in any time zone.
const now = new Date(2026, 10, 25, 15, 0, 0);
const at = (day: number, h: number, m: number) => new Date(2026, 10, day, h, m).toISOString();

function item(type: ActivityType, extra: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "e1",
    type,
    actorName: "Lan",
    subjectTitle: "Mua sữa",
    projectId: "p1",
    projectName: "Trà sữa Gác Nhỏ",
    taskId: "t1",
    ideaId: "i1",
    memberId: "m1",
    memberName: "Minh",
    occurredAt: at(25, 14, 58),
    read: false,
    ...extra,
  };
}

describe("groupByDay (AC30)", () => {
  it("puts today, yesterday and older days in their groups", () => {
    expect(groupByDay(at(25, 0, 1), now)).toBe("today");
    expect(groupByDay(at(25, 14, 58), now)).toBe("today");
    expect(groupByDay(at(24, 23, 59), now)).toBe("yesterday");
    expect(groupByDay(at(24, 0, 0), now)).toBe("yesterday");
    expect(groupByDay(at(23, 23, 59), now)).toBe("earlier");
    expect(groupByDay(at(1, 8, 0), now)).toBe("earlier");
  });

  it("counts a time slightly in the future as today", () => {
    expect(groupByDay(at(25, 15, 5), now)).toBe("today");
  });

  it("splits a newest-first feed into sections, leaving out empty groups", () => {
    const feed = [
      item("comment", { id: "a" }),
      item("idea", { id: "b", occurredAt: at(24, 20, 14) }),
      item("done", { id: "c", occurredAt: at(21, 9, 0) }),
    ];
    expect(sectionsOf(feed, now).map((s) => [s.group, s.items.map((i) => i.id)])).toEqual([
      ["today", ["a"]],
      ["yesterday", ["b"]],
      ["earlier", ["c"]],
    ]);
    expect(sectionsOf([feed[2]!], now).map((s) => s.group)).toEqual(["earlier"]);
    expect(sectionsOf([], now)).toEqual([]);
  });

  it("has a label for each group in both languages", () => {
    expect(["today", "yesterday", "earlier"].map((g) => tVi(`activity.groups.${g}`))).toEqual(["Hôm nay", "Hôm qua", "Trước đó"]);
    expect(["today", "yesterday", "earlier"].map((g) => tEn(`activity.groups.${g}`))).toEqual(["Today", "Yesterday", "Earlier"]);
  });
});

describe("relativeTime (AC30)", () => {
  it("reads minutes and hours today", () => {
    expect(relativeTime(at(25, 14, 58), now, tVi)).toBe("2 phút trước");
    expect(relativeTime(at(25, 14, 58), now, tEn)).toBe("2 min ago");
    expect(relativeTime(at(25, 14, 0), now, tVi)).toBe("1 giờ trước");
    expect(relativeTime(at(25, 14, 0), now, tEn)).toBe("1 hr ago");
    expect(relativeTime(at(25, 9, 30), now, tEn)).toBe("5 hr ago");
  });

  it("says just now inside the first minute and for a clock a little ahead", () => {
    expect(relativeTime(new Date(now.getTime() - 20_000).toISOString(), now, tEn)).toBe("Just now");
    expect(relativeTime(at(25, 15, 3), now, tVi)).toBe("Vừa xong");
  });

  it("shows the clock time yesterday", () => {
    expect(relativeTime(at(24, 20, 14), now, tVi)).toBe("Hôm qua, 20:14");
    expect(relativeTime(at(24, 8, 5), now, tEn)).toBe("Yesterday, 08:05");
  });

  it("shows day and month before that, with the year only when it differs", () => {
    expect(relativeTime(at(21, 9, 0), now, tVi)).toBe("21/11");
    expect(relativeTime(new Date(2025, 11, 3, 9, 0).toISOString(), now, tEn)).toBe("03/12/2025");
  });

  it("builds the meta line as project, then time", () => {
    expect(metaLine(item("comment"), now, tVi)).toBe("Trà sữa Gác Nhỏ · 2 phút trước");
    expect(metaLine(item("comment", { projectName: null }), now, tEn)).toBe("2 min ago");
  });
});

describe("rowText (AC30)", () => {
  it("reads the Vietnamese sentences", () => {
    expect(rowText(item("assigned"), tVi)).toBe("Lan đã giao cho bạn Mua sữa");
    expect(rowText(item("comment"), tVi)).toBe("Lan đã bình luận trong Mua sữa");
    expect(rowText(item("done"), tVi)).toBe("Lan đã hoàn thành Mua sữa");
    expect(rowText(item("idea"), tVi)).toBe("Lan đã thêm ý tưởng Mua sữa");
    expect(rowText(item("member_joined"), tVi)).toBe("Minh đã vào dự án");
  });

  it("reads the English sentences", () => {
    expect(rowText(item("assigned"), tEn)).toBe("Lan assigned you Mua sữa");
    expect(rowText(item("comment"), tEn)).toBe("Lan commented on Mua sữa");
    expect(rowText(item("done"), tEn)).toBe("Lan finished Mua sữa");
    expect(rowText(item("idea"), tEn)).toBe("Lan added the idea Mua sữa");
    expect(rowText(item("member_joined"), tEn)).toBe("Minh joined the project");
  });

  it("says Someone when the name is missing or blank", () => {
    expect(rowText(item("comment", { actorName: null }), tVi)).toBe("Ai đó đã bình luận trong Mua sữa");
    expect(rowText(item("done", { actorName: "  " }), tEn)).toBe("Someone finished Mua sữa");
    expect(rowText(item("member_joined", { memberName: null, actorName: null }), tEn)).toBe("Someone joined the project");
  });

  it("does not leave a hole when the title is gone", () => {
    expect(rowText(item("comment", { subjectTitle: null }), tEn)).toBe("Lan commented on an item");
  });
});

describe("rowTarget (AC31)", () => {
  const lookups = (found: boolean) => ({ isMember: () => found, hasTask: () => found, hasIdea: () => found });

  it("sends task events to the task, ideas to the idea and joins to Members", () => {
    expect(rowTarget(item("assigned"))).toEqual({ type: "task", projectId: "p1", taskId: "t1" });
    expect(rowTarget(item("comment"))).toEqual({ type: "task", projectId: "p1", taskId: "t1" });
    expect(rowTarget(item("done"))).toEqual({ type: "task", projectId: "p1", taskId: "t1" });
    expect(rowTarget(item("idea"))).toEqual({ type: "idea", projectId: "p1", ideaId: "i1" });
    expect(rowTarget(item("member_joined"))).toEqual({ type: "members", projectId: "p1" });
  });

  it("falls back to the project when the task or idea id is missing", () => {
    expect(rowTarget(item("comment", { taskId: null }))).toEqual({ type: "project", projectId: "p1" });
    expect(rowTarget(item("idea", { ideaId: null }))).toEqual({ type: "project", projectId: "p1" });
  });

  it("opens the same routes a push tap does", () => {
    const go = (type: ActivityType, found: boolean) => {
      const target = rowTarget(item(type));
      return tapDestination(target, tapFound(target, lookups(found)));
    };
    expect(go("comment", true)).toEqual({ pathname: "/projects/[id]/tasks/[taskId]", params: { id: "p1", taskId: "t1" } });
    expect(go("idea", true)).toEqual({ pathname: "/projects/[id]/ideas/[ideaId]", params: { id: "p1", ideaId: "i1" } });
    expect(go("member_joined", true)).toEqual({ pathname: "/projects/[id]/members", params: { id: "p1" } });
    // Gone or left: the project list, no error.
    expect(go("comment", false)).toEqual({ pathname: "/projects" });
    expect(go("member_joined", false)).toEqual({ pathname: "/projects" });
  });
});

describe("activityIcon", () => {
  it("has one icon per type", () => {
    expect(activityIcon("assigned")).toBe("clipboard-outline");
    expect(activityIcon("comment")).toBe("chatbubble-outline");
    expect(activityIcon("done")).toBe("checkmark-circle-outline");
    expect(activityIcon("idea")).toBe("bulb-outline");
    expect(activityIcon("member_joined")).toBe("person-add-outline");
  });
});
