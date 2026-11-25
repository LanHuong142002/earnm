import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { recordActivity } from "../activity/record.js";
import { addMember, createSignedInUser, prisma, useTestApp } from "../test/helpers.js";
import { flushActivity, nextActivityDueAt } from "./activity.js";
import { runCatchUp } from "./catchUp.js";
import { createFakeSender } from "./sender.js";

const SECRET = "test-only-fake-internal-secret-0123456789abcdef";
const T0 = new Date("2026-01-01T00:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);
const LONG_AGO = new Date("2025-12-01T00:00:00Z");

describe("flushActivity", () => {
  const { clock } = useTestApp();

  async function mkProject(name: string, members: { id: string }[]) {
    const project = await prisma.project.create({
      data: { id: randomUUID(), name, currency: "VND", nameEditedAt: LONG_AGO, descriptionEditedAt: LONG_AGO, currencyEditedAt: LONG_AGO },
    });
    for (const m of members) await addMember(project.id, m.id, "member");
    return project;
  }

  const mkTask = (projectId: string, title: string, createdById: string) =>
    prisma.task.create({
      data: {
        id: randomUUID(),
        projectId,
        title,
        titleEditedAt: LONG_AGO,
        descriptionEditedAt: LONG_AGO,
        statusEditedAt: LONG_AGO,
        dueEditedAt: LONG_AGO,
        assigneesEditedAt: LONG_AGO,
        createdById,
      },
    });

  async function world() {
    const actor = await createSignedInUser(clock);
    const alice = await createSignedInUser(clock);
    await prisma.user.update({ where: { id: actor.id }, data: { displayName: "Lan" } });
    const project = await mkProject("Nhà mới", [actor, alice]);
    const task = await mkTask(project.id, "Đặt cọc", actor.id);
    await prisma.devicePushToken.create({ data: { token: "ExponentPushToken[alice]", userId: alice.id } });
    clock.set(T0);
    return { actor, alice, project, task };
  }

  type World = Awaited<ReturnType<typeof world>>;

  /** Records an event for alice at the clock's current time (or `occurredAt`). */
  function record(
    w: World,
    type: "assigned" | "comment" | "done" | "idea" | "member_joined",
    extra: { taskId?: string | null; ideaId?: string | null; memberId?: string | null; title?: string; occurredAt?: Date; projectId?: string } = {},
  ) {
    const now = clock.now();
    return recordActivity(prisma, {
      type,
      projectId: extra.projectId ?? w.project.id,
      actorId: w.actor.id,
      taskId: extra.taskId === undefined ? (type === "idea" || type === "member_joined" ? null : w.task.id) : extra.taskId,
      ideaId: extra.ideaId ?? null,
      memberId: extra.memberId ?? null,
      subjectTitle: extra.title ?? "Đặt cọc",
      occurredAt: extra.occurredAt ?? now,
      recipients: [w.alice.id],
      now,
    });
  }

  const flush = (sender: ReturnType<typeof createFakeSender> | null, seconds: number) =>
    flushActivity({ prisma, sender, now: at(seconds) });
  const states = async () =>
    (await prisma.activityRecipient.findMany({ orderBy: { occurredAt: "asc" } })).map((r) => r.pushState);

  it("sends nothing before the window ends, then one push with the batch (AC12)", async () => {
    const w = await world();
    await record(w, "assigned");
    clock.advanceMs(20_000);
    await record(w, "comment");
    const sender = createFakeSender();
    await flush(sender, 59);
    expect(sender.sent).toHaveLength(0);
    const summary = await flush(sender, 60);
    expect(summary.sent).toBe(2);
    expect(sender.sent).toHaveLength(1);
    const m = sender.sent[0]!;
    expect(m.to).toBe("ExponentPushToken[alice]");
    expect(m.title).toBe("Nhà mới");
    expect(m.body.split("\n")).toEqual(["Lan đã bình luận trong Đặt cọc", "Lan đã giao cho bạn Đặt cọc"]);
    expect(m.data).toMatchObject({ kind: "activity", projectId: w.project.id, target: { type: "task", taskId: w.task.id } });
    expect((m.data["eventIds"] as string[]).length).toBe(2);
    expect(await states()).toEqual(["sent", "sent"]);
    const row = await prisma.activityRecipient.findFirst();
    expect(row?.sentAt).toEqual(at(60));
  });

  it("a later event opens its own window and goes out as a second push (AC12)", async () => {
    const w = await world();
    await record(w, "assigned");
    const sender = createFakeSender();
    await flush(sender, 60);
    clock.set(at(90));
    await record(w, "done");
    await flush(sender, 120);
    expect(sender.sent).toHaveLength(1);
    await flush(sender, 150);
    expect(sender.sent).toHaveLength(2);
    expect(sender.sent[1]!.body).toBe("Lan đã hoàn thành Đặt cọc");
  });

  it("sends one push per project, titled by the project (AC13)", async () => {
    const w = await world();
    const second = await mkProject("Công ty", [w.actor, w.alice]);
    const task2 = await mkTask(second.id, "Báo cáo", w.actor.id);
    await record(w, "assigned");
    await record(w, "assigned", { projectId: second.id, taskId: task2.id, title: "Báo cáo" });
    const sender = createFakeSender();
    await flush(sender, 60);
    expect(sender.sent.map((m) => m.title).sort()).toEqual(["Công ty", "Nhà mới"]);
    const mixed = sender.sent.find((m) => m.title === "Công ty")!;
    expect(mixed.data).toMatchObject({ projectId: second.id, target: { type: "task", taskId: task2.id } });
  });

  it("shows three lines and how many more, in the person's language (AC13)", async () => {
    const w = await world();
    for (let i = 0; i < 5; i++) {
      clock.advanceMs(1000);
      await record(w, "assigned", { title: `T${i}` });
    }
    const sender = createFakeSender();
    await flush(sender, 100);
    expect(sender.sent[0]!.body.split("\n")).toEqual([
      "Lan đã giao cho bạn T4",
      "Lan đã giao cho bạn T3",
      "Lan đã giao cho bạn T2",
      "+2 nữa",
    ]);

    await prisma.activityRecipient.deleteMany({});
    await prisma.user.update({ where: { id: w.alice.id }, data: { language: "en" } });
    clock.set(at(200));
    for (let i = 0; i < 5; i++) {
      clock.advanceMs(1000);
      await record(w, "assigned", { title: `T${i}` });
    }
    const sender2 = createFakeSender();
    await flush(sender2, 300);
    expect(sender2.sent[0]!.body.split("\n").at(-1)).toBe("+2 more");
    expect(sender2.sent[0]!.body.split("\n")[0]).toBe("Lan assigned you T4");
  });

  it("targets the project when events differ, the idea for one idea, members for joins (R24)", async () => {
    const w = await world();
    const idea = await prisma.idea.create({ data: { id: randomUUID(), projectId: w.project.id, title: "Sơn tường", authorId: w.actor.id } });
    await record(w, "idea", { ideaId: idea.id, title: "Sơn tường" });
    const s1 = createFakeSender();
    await flush(s1, 60);
    expect(s1.sent[0]!.data["target"]).toEqual({ type: "idea", ideaId: idea.id });

    await record(w, "member_joined", { memberId: w.actor.id, title: "" });
    const s2 = createFakeSender();
    await flush(s2, 120);
    expect(s2.sent[0]!.data["target"]).toEqual({ type: "members" });
    expect(s2.sent[0]!.body).toBe("Lan đã vào dự án");

    await record(w, "assigned");
    await record(w, "idea", { ideaId: idea.id, title: "Sơn tường" });
    const s3 = createFakeSender();
    await flush(s3, 180);
    expect(s3.sent[0]!.data["target"]).toEqual({ type: "project" });
  });

  it("sends nothing and drops the row when the person left the project (AC7)", async () => {
    const w = await world();
    await record(w, "assigned");
    await prisma.projectMember.deleteMany({ where: { userId: w.alice.id, projectId: w.project.id } });
    const sender = createFakeSender();
    const summary = await flush(sender, 60);
    expect(sender.sent).toHaveLength(0);
    expect(summary.dropped).toBe(1);
    expect(await states()).toEqual(["dropped"]);
  });

  it("sends nothing and drops the row when the task was deleted (AC7)", async () => {
    const w = await world();
    await record(w, "comment");
    await prisma.task.delete({ where: { id: w.task.id } });
    const sender = createFakeSender();
    await flush(sender, 60);
    expect(sender.sent).toHaveLength(0);
    expect(await states()).toEqual(["dropped"]);
  });

  it("sends nothing when the idea was deleted (AC7)", async () => {
    const w = await world();
    const idea = await prisma.idea.create({ data: { id: randomUUID(), projectId: w.project.id, title: "Sơn tường" } });
    await record(w, "idea", { ideaId: idea.id });
    await prisma.idea.delete({ where: { id: idea.id } });
    const sender = createFakeSender();
    await flush(sender, 60);
    expect(sender.sent).toHaveLength(0);
    expect(await states()).toEqual(["dropped"]);
  });

  it("keeps the events that are still valid in a batch when another was deleted (AC7)", async () => {
    const w = await world();
    const other = await mkTask(w.project.id, "Khác", w.actor.id);
    await record(w, "assigned", { taskId: other.id, title: "Khác" });
    await record(w, "assigned");
    await prisma.task.delete({ where: { id: other.id } });
    const sender = createFakeSender();
    await flush(sender, 60);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.body).toBe("Lan đã giao cho bạn Đặt cọc");
  });

  it("a tick with no timer sends the batches that came due; an event over an hour old is dropped (AC14)", async () => {
    const w = await world();
    await record(w, "assigned");
    const sender = createFakeSender();
    const app = createApp({ prisma, now: () => at(70), internalSecret: SECRET, pushSender: sender });
    const res = await request(app).post("/internal/tick").set("Authorization", `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(sender.sent).toHaveLength(1);
    expect(await states()).toEqual(["sent"]);

    // A row that was never flushed and is now over an hour old is dropped, not sent.
    await prisma.activityRecipient.deleteMany({});
    await record(w, "assigned");
    const late = createFakeSender();
    await flush(late, 2 * 3600);
    expect(late.sent).toHaveLength(0);
    expect(await states()).toEqual(["dropped"]);
  });

  it("the tick deletes events older than 30 days, with or without a sender", async () => {
    const w = await world();
    const old = new Date(T0.getTime() - 31 * 86_400_000);
    const recent = new Date(T0.getTime() - 29 * 86_400_000);
    for (const occurredAt of [old, recent]) {
      const e = await prisma.activityEvent.create({ data: { projectId: w.project.id, type: "done", actorId: w.actor.id, taskId: w.task.id, subjectTitle: "x", occurredAt } });
      await prisma.activityRecipient.create({ data: { eventId: e.id, userId: w.alice.id, occurredAt, pushState: "late" } });
    }
    const noSender = createApp({ prisma, now: () => T0, internalSecret: SECRET });
    await request(noSender).post("/internal/tick").set("Authorization", `Bearer ${SECRET}`).expect(200);
    const left = await prisma.activityEvent.findMany();
    expect(left.map((e) => e.occurredAt)).toEqual([recent]);
    expect(await prisma.activityRecipient.count()).toBe(1);
  });

  it("delivers to every device of the person (AC15)", async () => {
    const w = await world();
    await prisma.devicePushToken.create({ data: { token: "ExponentPushToken[alice2]", userId: w.alice.id } });
    await record(w, "assigned");
    const sender = createFakeSender();
    await flush(sender, 60);
    expect(sender.sent.map((m) => m.to).sort()).toEqual(["ExponentPushToken[alice2]", "ExponentPushToken[alice]"]);
    expect(await states()).toEqual(["sent"]);
  });

  it("two flushes at once send each event once (AC15)", async () => {
    const w = await world();
    await record(w, "assigned");
    const sender = createFakeSender();
    await Promise.all([flush(sender, 60), flush(sender, 60)]);
    expect(sender.sent).toHaveLength(1);
  });

  it("a flush and a tick at once send each event once (AC15)", async () => {
    const w = await world();
    await record(w, "assigned");
    const sender = createFakeSender();
    const app = createApp({ prisma, now: () => at(60), internalSecret: SECRET, pushSender: sender });
    await Promise.all([flush(sender, 60), request(app).post("/internal/tick").set("Authorization", `Bearer ${SECRET}`)]);
    expect(sender.sent).toHaveLength(1);
  });

  it("does not send a row that another runner already claimed (AC15)", async () => {
    const w = await world();
    await record(w, "assigned");
    await prisma.activityRecipient.updateMany({ data: { attempts: 1, lastAttemptAt: at(60) } });
    const sender = createFakeSender();
    await flush(sender, 61);
    expect(sender.sent).toHaveLength(0);
  });

  it("retries a failing send at most 3 times, 2 minutes apart, then drops it (AC16)", async () => {
    const w = await world();
    await record(w, "assigned");
    const sender = createFakeSender();
    sender.failing.add("ExponentPushToken[alice]");
    await flush(sender, 60);
    expect(sender.sent).toHaveLength(1);
    expect(await states()).toEqual(["pending"]);
    await flush(sender, 100); // too soon
    expect(sender.sent).toHaveLength(1);
    await flush(sender, 181);
    expect(sender.sent).toHaveLength(2);
    expect(await states()).toEqual(["pending"]);
    await flush(sender, 302);
    expect(sender.sent).toHaveLength(3);
    expect(await states()).toEqual(["dropped"]);
    await flush(sender, 3000);
    expect(sender.sent).toHaveLength(3);
  });

  it("caps the event ids in the push data at the newest 50 and still settles every row (R15)", async () => {
    const w = await world();
    for (let i = 0; i < 120; i++) await record(w, "comment", { occurredAt: new Date(T0.getTime() - i * 1000) });
    const sender = createFakeSender();
    const summary = await flush(sender, 60);
    expect(summary.sent).toBe(120);
    expect(sender.sent).toHaveLength(1);
    const ids = (sender.sent[0]!.data as { eventIds: string[] }).eventIds;
    expect(ids).toHaveLength(50);
    const newest = await prisma.activityEvent.findMany({ orderBy: { occurredAt: "desc" }, take: 50 });
    expect(new Set(ids)).toEqual(new Set(newest.map((e) => e.id)));
    expect((await states()).every((s) => s === "sent")).toBe(true);
  });

  it("reports when the next send is due: a window end, then a retry 2 minutes after a failure", async () => {
    const w = await world();
    await expect(nextActivityDueAt(prisma)).resolves.toBeNull();
    await record(w, "assigned");
    await expect(nextActivityDueAt(prisma)).resolves.toEqual(at(60));
    const sender = createFakeSender();
    sender.failing.add("ExponentPushToken[alice]");
    await flush(sender, 60);
    await expect(nextActivityDueAt(prisma)).resolves.toEqual(at(180));
    sender.failing.clear();
    await flush(sender, 181);
    await expect(nextActivityDueAt(prisma)).resolves.toBeNull();
  });

  it("a retry succeeds once the sender recovers (AC16)", async () => {
    const w = await world();
    await record(w, "assigned");
    const sender = createFakeSender();
    sender.failing.add("ExponentPushToken[alice]");
    await flush(sender, 60);
    sender.failing.clear();
    await flush(sender, 181);
    expect(await states()).toEqual(["sent"]);
  });

  it("deletes a token the push service reports as gone (AC16)", async () => {
    const w = await world();
    await record(w, "assigned");
    await flush(createFakeSender(["ExponentPushToken[alice]"]), 60);
    expect(await prisma.devicePushToken.count({ where: { userId: w.alice.id } })).toBe(0);
    // With nothing left to deliver to, the next try drops the row.
    await flush(createFakeSender(), 181);
    expect(await states()).toEqual(["dropped"]);
  });

  it("drops the row for a person with no device", async () => {
    const w = await world();
    await prisma.devicePushToken.deleteMany({});
    await record(w, "assigned");
    const sender = createFakeSender();
    await flush(sender, 60);
    expect(sender.sent).toHaveLength(0);
    expect(await states()).toEqual(["dropped"]);
  });

  it("does nothing and does not fail without a sender (AC16)", async () => {
    const w = await world();
    await record(w, "assigned");
    await expect(flush(null, 60)).resolves.toEqual({ sent: 0, dropped: 0, muted: 0 });
    expect(await states()).toEqual(["pending"]);
    const app = createApp({ prisma, now: () => at(60), internalSecret: SECRET });
    await request(app).post("/internal/tick").set("Authorization", `Bearer ${SECRET}`).expect(200);
    expect(await states()).toEqual(["pending"]);
  });

  it("marks muted, and does not send, an event type the person muted (AC20)", async () => {
    const w = await world();
    await prisma.notificationTypeMute.create({ data: { userId: w.alice.id, type: "comment" } });
    await record(w, "comment");
    await record(w, "assigned");
    const sender = createFakeSender();
    const summary = await flush(sender, 60);
    expect(summary.muted).toBe(1);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.body).toBe("Lan đã giao cho bạn Đặt cọc");
    expect((await states()).sort()).toEqual(["muted", "sent"]);
  });

  it("marks muted, and does not send, a project the person muted (AC20)", async () => {
    const w = await world();
    await record(w, "assigned");
    await prisma.projectNotificationMute.create({ data: { userId: w.alice.id, projectId: w.project.id } });
    const sender = createFakeSender();
    await flush(sender, 60);
    expect(sender.sent).toHaveLength(0);
    expect(await states()).toEqual(["muted"]);
  });

  it("still sends reminder pushes to someone who muted every activity type (AC22)", async () => {
    const w = await world();
    for (const type of ["assigned", "comment", "done", "idea", "member_joined"] as const) {
      await prisma.notificationTypeMute.create({ data: { userId: w.alice.id, type } });
    }
    await prisma.projectNotificationMute.create({ data: { userId: w.alice.id, projectId: w.project.id } });
    await prisma.taskReminder.create({
      data: {
        id: randomUUID(),
        taskId: w.task.id,
        startDate: new Date("2025-12-30T00:00:00Z"),
        time: "09:00",
        timezone: "Asia/Ho_Chi_Minh",
        repeat: "daily",
        weekdays: [],
        scheduleEditedAt: LONG_AGO,
        recipientsEditedAt: LONG_AGO,
        changedAt: LONG_AGO,
        createdById: w.actor.id,
        recipients: { create: [{ userId: w.alice.id }] },
      },
    });
    const sender = createFakeSender();
    await runCatchUp({ prisma, sender, now: new Date("2026-01-01T02:05:00Z") });
    expect(sender.sent.map((m) => m.to)).toEqual(["ExponentPushToken[alice]"]);
    expect(sender.sent[0]!.title).toBe("Đặt cọc");
  });
});
