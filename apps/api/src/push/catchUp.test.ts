import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addMember, createSignedInUser, prisma, useTestApp } from "../test/helpers.js";
import { runCatchUp } from "./catchUp.js";
import { createFakeSender } from "./sender.js";

const DAY = 86_400_000;
// Daily at 09:00 in Ho Chi Minh City = 02:00 UTC.
const NOW = new Date("2026-01-01T02:05:00Z");
const LONG_AGO = new Date("2025-12-01T00:00:00Z");

describe("runCatchUp", () => {
  const { clock } = useTestApp();

  async function world(opts: { due?: boolean; status?: "todo" | "done" } = {}) {
    const alice = await createSignedInUser(clock);
    const bob = await createSignedInUser(clock);
    const other = await createSignedInUser(clock);
    const at = LONG_AGO;
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "Nhà mới", currency: "VND", nameEditedAt: at, descriptionEditedAt: at, currencyEditedAt: at },
    });
    for (const u of [alice, bob, other]) await addMember(project.id, u.id, "member");
    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        projectId: project.id,
        title: "Đặt cọc",
        status: opts.status ?? "todo",
        ...(opts.due === false ? {} : { dueDate: new Date("2026-01-05T00:00:00Z"), dueTime: "15:00" }),
        titleEditedAt: at,
        descriptionEditedAt: at,
        statusEditedAt: at,
        dueEditedAt: at,
        assigneesEditedAt: at,
        labelsEditedAt: at,
        createdById: alice.id,
      },
    });
    const reminder = await prisma.taskReminder.create({
      data: {
        id: randomUUID(),
        taskId: task.id,
        startDate: new Date("2025-12-30T00:00:00Z"),
        time: "09:00",
        timezone: "Asia/Ho_Chi_Minh",
        repeat: "daily",
        weekdays: [],
        scheduleEditedAt: LONG_AGO,
        recipientsEditedAt: LONG_AGO,
        changedAt: LONG_AGO,
        createdById: alice.id,
        recipients: { create: [{ userId: alice.id }, { userId: bob.id }] },
      },
    });
    await prisma.devicePushToken.create({ data: { token: "ExponentPushToken[alice]", userId: alice.id } });
    await prisma.devicePushToken.create({ data: { token: "ExponentPushToken[bob]", userId: bob.id } });
    await prisma.devicePushToken.create({ data: { token: "ExponentPushToken[other]", userId: other.id } });
    return { alice, bob, other, project, task, reminder };
  }

  const comment = (taskId: string, authorId: string, text: string, createdAt: Date, remindWith = true) =>
    prisma.taskComment.create({
      data: { id: randomUUID(), taskId, authorId, text, remindWith, createdAt, remindWithEditedAt: createdAt },
    });

  it("sends one push to each recipient's device for an occurrence due since the last tick (AC20)", async () => {
    const w = await world();
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    expect(sender.sent.map((m) => m.to).sort()).toEqual(["ExponentPushToken[alice]", "ExponentPushToken[bob]"]);
    expect(sender.sent[0]!.title).toBe("Đặt cọc");
    expect(sender.sent[0]!.data).toEqual({ projectId: w.project.id, taskId: w.task.id });
  });

  it("builds the body from the due date and project name, then up to three comments, newest first (AC16)", async () => {
    const w = await world();
    await comment(w.task.id, w.alice.id, "one", new Date("2025-12-20T00:00:00Z"));
    await comment(w.task.id, w.bob.id, "two", new Date("2025-12-21T00:00:00Z"));
    await comment(w.task.id, w.bob.id, "three", new Date("2025-12-22T00:00:00Z"));
    await comment(w.task.id, w.bob.id, "four", new Date("2025-12-23T00:00:00Z"));
    await comment(w.task.id, w.bob.id, "not attached", new Date("2025-12-24T00:00:00Z"), false);
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    const lines = sender.sent[0]!.body.split("\n");
    expect(lines).toEqual(["T2, 5/1 · 15:00 · Nhà mới", "Bob: four", "Bob: three", "Bob: two"]);
  });

  it("shows only the project name when the task has no due date, and cuts long comments", async () => {
    const w = await world({ due: false });
    await comment(w.task.id, w.bob.id, "x".repeat(300), new Date("2025-12-20T00:00:00Z"));
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    const lines = sender.sent[0]!.body.split("\n");
    expect(lines[0]).toBe("Nhà mới");
    expect(lines[1]!.length).toBeLessThanOrEqual(100);
    expect(lines[1]!.endsWith("…")).toBe(true);
  });

  it("uses the recipient's language for the date", async () => {
    const w = await world();
    await prisma.user.update({ where: { id: w.bob.id }, data: { language: "en" } });
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    const bob = sender.sent.find((m) => m.to === "ExponentPushToken[bob]")!;
    expect(bob.body).toBe("Mon, 5 Jan · 15:00 · Nhà mới");
  });

  it("skips a recipient whose device synced after the content version, but not one who did not", async () => {
    await world();
    await prisma.devicePushToken.update({
      where: { token: "ExponentPushToken[alice]" },
      data: { lastSyncedAt: new Date("2025-12-31T00:00:00Z") },
    });
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    expect(sender.sent.map((m) => m.to)).toEqual(["ExponentPushToken[bob]"]);
  });

  it("sends to a synced recipient when a Nhắc kèm comment is newer than their last sync", async () => {
    const w = await world();
    await prisma.devicePushToken.update({
      where: { token: "ExponentPushToken[alice]" },
      data: { lastSyncedAt: new Date("2025-12-31T00:00:00Z") },
    });
    await comment(w.task.id, w.bob.id, "new note", new Date("2025-12-31T12:00:00Z"));
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    expect(sender.sent.map((m) => m.to).sort()).toEqual(["ExponentPushToken[alice]", "ExponentPushToken[bob]"]);
  });

  it("needs every device of a recipient to be out of date", async () => {
    const w = await world();
    await prisma.devicePushToken.create({
      data: { token: "ExponentPushToken[alice2]", userId: w.alice.id, lastSyncedAt: new Date("2025-12-31T00:00:00Z") },
    });
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    expect(sender.sent.map((m) => m.to)).toEqual(["ExponentPushToken[bob]"]);

    await prisma.devicePushToken.update({ where: { token: "ExponentPushToken[alice]" }, data: { lastSyncedAt: null } });
    await prisma.devicePushToken.update({ where: { token: "ExponentPushToken[alice2]" }, data: { lastSyncedAt: null } });
    await prisma.tickState.deleteMany({});
    const again = createFakeSender();
    await runCatchUp({ prisma, sender: again, now: NOW });
    expect(again.sent.map((m) => m.to).sort()).toEqual(["ExponentPushToken[alice2]", "ExponentPushToken[alice]"]);
  });

  it("sends an occurrence at most once across ticks", async () => {
    await world();
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    const first = sender.sent.length;
    expect(first).toBe(2);
    await runCatchUp({ prisma, sender, now: new Date(NOW.getTime() + 60_000) });
    expect(sender.sent.length).toBe(first);
    // Even when the previous tick time is lost and the window covers the same occurrence again.
    await prisma.tickState.deleteMany({});
    await runCatchUp({ prisma, sender, now: new Date(NOW.getTime() + 120_000) });
    expect(sender.sent.length).toBe(first);
  });

  it("sends nothing for a done task", async () => {
    await world({ status: "done" });
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    expect(sender.sent).toEqual([]);
  });

  it("looks back only to the previous tick, and never more than 15 minutes", async () => {
    await world();
    // Previous tick after the occurrence: nothing is due since.
    await prisma.tickState.create({ data: { id: "tick", lastTickAt: new Date("2026-01-01T02:01:00Z") } });
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    expect(sender.sent).toEqual([]);

    // Previous tick a day ago, occurrence 20 minutes ago: outside the 15 minute window.
    await prisma.tickState.update({ where: { id: "tick" }, data: { lastTickAt: new Date(NOW.getTime() - DAY) } });
    const late = createFakeSender();
    await runCatchUp({ prisma, sender: late, now: new Date("2026-01-01T02:20:00Z") });
    expect(late.sent).toEqual([]);
  });

  it("records the tick time", async () => {
    await world();
    await runCatchUp({ prisma, sender: createFakeSender(), now: NOW });
    expect((await prisma.tickState.findUnique({ where: { id: "tick" } }))!.lastTickAt).toEqual(NOW);
  });

  it("deletes tokens the push service reports as no longer registered", async () => {
    await world();
    const sender = createFakeSender(["ExponentPushToken[bob]"]);
    await runCatchUp({ prisma, sender, now: NOW });
    const left = (await prisma.devicePushToken.findMany()).map((t) => t.token).sort();
    expect(left).toEqual(["ExponentPushToken[alice]", "ExponentPushToken[other]"]);
  });

  it("does not send to people who are not recipients", async () => {
    await world();
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: NOW });
    expect(sender.sent.some((m) => m.to === "ExponentPushToken[other]")).toBe(false);
  });

  it("does nothing, and does not call the sender, when no device token exists", async () => {
    await world();
    await prisma.devicePushToken.deleteMany({});
    const sender = createFakeSender();
    const result = await runCatchUp({ prisma, sender, now: NOW });
    expect(sender.sent).toEqual([]);
    expect(result.sent).toBe(0);
  });
});
