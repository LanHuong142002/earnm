import { describe, expect, it } from "vitest";

import en from "../../i18n/en.json";
import vi from "../../i18n/vi.json";
import type { Task } from "../types";
import { HORIZON_DAYS, MAX_PENDING, planNotifications, type PlanInput } from "./scheduler";
import type { Reminder } from "./types";

function translator(dict: unknown) {
  return (key: string): string => {
    let node: unknown = dict;
    for (const part of key.split(".")) node = (node as Record<string, unknown> | undefined)?.[part];
    return typeof node === "string" ? node : key;
  };
}
const tVi = translator(vi);
const tEn = translator(en);

const DAY = 86_400_000;
const now = new Date("2026-11-12T03:00:00Z"); // 10:00 in Ho Chi Minh City

const task = (patch: Partial<Task> = {}): Task => ({
  id: "t1",
  projectId: "p1",
  title: "Đặt cọc",
  description: "",
  status: "todo",
  dueDate: "2026-11-20",
  dueTime: "15:00",
  assignees: [],
  createdById: "me",
  createdAt: "2026-11-01T00:00:00.000Z",
  labelIds: [],
  checklists: [],
  ...patch,
});

const reminder = (id: string, patch: Partial<Reminder> = {}): Reminder => ({
  id,
  taskId: "t1",
  startDate: "2026-11-01",
  time: "09:00",
  timezone: "Asia/Ho_Chi_Minh",
  repeat: "daily",
  weekdays: [],
  endDate: null,
  recipientIds: ["me"],
  createdById: "me",
  changedAt: "2026-11-01T00:00:00.000Z",
  state: "synced",
  ...patch,
});

function input(patch: Partial<PlanInput> = {}): PlanInput {
  return {
    reminders: [reminder("r1")],
    tasks: [task()],
    remindWith: {},
    projectNames: { p1: "Nhà mới" },
    meId: "me",
    now,
    lang: "vi",
    t: tVi,
    ...patch,
  };
}

describe("planNotifications (AC18)", () => {
  it("plans the next 14 days of a daily reminder with stable identifiers", () => {
    const plan = planNotifications(input());
    // 09:00 (02:00Z) every day: Nov 13 .. Nov 26 (Nov 12's moment has passed).
    expect(plan).toHaveLength(HORIZON_DAYS);
    expect(plan[0]!.at.toISOString()).toBe("2026-11-13T02:00:00.000Z");
    expect(plan[0]!.identifier).toBe("r1@2026-11-13T02:00:00.000Z");
    expect(plan.at(-1)!.at.toISOString()).toBe("2026-11-26T02:00:00.000Z");
  });

  it("is idempotent", () => {
    expect(planNotifications(input())).toEqual(planNotifications(input()));
  });

  it("only includes reminders where I am a recipient", () => {
    const plan = planNotifications(input({ reminders: [reminder("r1", { recipientIds: ["other"] }), reminder("r2", { recipientIds: ["other", "me"], repeat: "once", startDate: "2026-11-15" })] }));
    expect(plan.map((p) => p.identifier)).toEqual(["r2@2026-11-15T02:00:00.000Z"]);
  });

  it("includes nothing for a done task, and nothing for a task it does not know", () => {
    expect(planNotifications(input({ tasks: [task({ status: "done" })] }))).toEqual([]);
    expect(planNotifications(input({ tasks: [] }))).toEqual([]);
  });

  it("stops at the end date and skips a one-off that has passed", () => {
    const plan = planNotifications(input({ reminders: [reminder("r1", { endDate: "2026-11-14" }), reminder("r2", { repeat: "once", startDate: "2026-11-10" })] }));
    expect(plan.map((p) => p.identifier)).toEqual(["r1@2026-11-13T02:00:00.000Z", "r1@2026-11-14T02:00:00.000Z"]);
  });

  it("keeps the nearest 64 across reminders, in time order", () => {
    const many = Array.from({ length: 8 }, (_, i) => reminder(`r${i}`, { time: `0${i + 1}:00` }));
    const plan = planNotifications(input({ reminders: many }));
    expect(plan).toHaveLength(MAX_PENDING);
    const times = plan.map((p) => p.at.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    // 8 reminders x 14 days = 112 candidates; the 64 nearest end before the 9th day.
    expect(times.at(-1)!).toBeLessThan(now.getTime() + 9 * DAY);
  });

  it("includes waiting reminders", () => {
    expect(planNotifications(input({ reminders: [reminder("r1", { state: "waiting" })] })).length).toBe(HORIZON_DAYS);
  });
});

describe("notification content (AC16)", () => {
  it("title is the task title; the first line is the due date and time with the project", () => {
    const [first] = planNotifications(input());
    expect(first).toMatchObject({ title: "Đặt cọc", data: { projectId: "p1", taskId: "t1" } });
    expect(first!.body).toBe("T6, 20/11 · 15:00 · Nhà mới");
  });

  it("is only the project name when the task has no due date", () => {
    const [first] = planNotifications(input({ tasks: [task({ dueDate: null, dueTime: null })] }));
    expect(first!.body).toBe("Nhà mới");
  });

  it("uses the language for the date", () => {
    const [first] = planNotifications(input({ lang: "en", t: tEn }));
    expect(first!.body).toBe("Fri, 20 Nov · 15:00 · Nhà mới");
  });

  it.each([0, 1, 2, 3, 4])("adds up to three Nhắc kèm lines, as Name: text (%i comments)", (count) => {
    const lines = Array.from({ length: count }, (_, i) => ({ author: `U${i}`, text: `note ${i}` }));
    const [first] = planNotifications(input({ remindWith: { t1: lines } }));
    const expected = lines.slice(0, 3).map((l) => `${l.author}: ${l.text}`);
    expect(first!.body.split("\n").slice(1)).toEqual(expected);
  });

  it("shows a comment without an author as its text, and cuts a long one", () => {
    const [first] = planNotifications(input({ remindWith: { t1: [{ author: null, text: "x".repeat(300) }, { author: "A", text: "ok" }] } }));
    const lines = first!.body.split("\n");
    expect(lines[1]!.length).toBeLessThanOrEqual(100);
    expect(lines[1]!.endsWith("…")).toBe(true);
    expect(lines[2]).toBe("A: ok");
  });
});
