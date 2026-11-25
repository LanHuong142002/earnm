import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { addMember, createClock, createSignedInUser, prisma, useTestApp } from "../test/helpers.js";
import { recordActivity } from "./record.js";

// Ticket #16: the five write paths save an activity event (and one row per person to tell) in the
// same transaction as the change. These tests read the rows; nothing is pushed here.
describe("activity recording", () => {
  useTestApp(); // truncates the tables before each test
  const clock = createClock();
  const scheduled: Date[] = [];
  const app = createApp({
    prisma,
    now: clock.now,
    activityScheduler: { schedule: (d) => void scheduled.push(d) },
  });

  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);
  const bearer = (u: User): [string, string] => ["Authorization", `Bearer ${u.token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  const MIN = 60_000;

  async function seed(owner: User, members: User[] = []) {
    const t = clock.now();
    const p = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t, descriptionEditedAt: t, currencyEditedAt: t },
    });
    await addMember(p.id, owner.id, "owner");
    for (const m of members) await addMember(p.id, m.id, "member");
    return p.id;
  }

  const createTask = (u: User, p: string, body: Record<string, unknown> = {}) =>
    request(app)
      .post(`/projects/${p}/tasks`)
      .set(...bearer(u))
      .send({ id: randomUUID(), title: "Mua ly", editedAt: iso(), ...body });
  // The server caps an edit time at its own now, and an edit only wins over an older stored time.
  // So each patch moves the clock on by a second first; the callers' times are built before that.
  const patchTask = (u: User, p: string, t: string, fields: Record<string, unknown>) => {
    const req = request(app).patch(`/projects/${p}/tasks/${t}`).set(...bearer(u)).send({ fields });
    clock.advanceMs(1000);
    return req;
  };
  const setStatus = (u: User, p: string, t: string, value: string) =>
    patchTask(u, p, t, { status: { value, editedAt: iso() } });

  async function events() {
    return prisma.activityEvent.findMany({ include: { recipients: true }, orderBy: { createdAt: "asc" } });
  }
  const who = (e: { recipients: { userId: string }[] }) => e.recipients.map((r) => r.userId).sort();
  const sorted = (...u: User[]) => u.map((x) => x.id).sort();

  /** A project with an owner, two members, and a task the first member created. */
  async function world(opts: { assignB?: boolean } = {}) {
    const owner = await user();
    const a = await user();
    const b = await user();
    const p = await seed(owner, [a, b]);
    const res = await createTask(a, p, opts.assignB ? { assigneeIds: [b.id] } : {});
    expect(res.status).toBe(201);
    clock.advanceMs(2 * 60 * MIN); // the task's own edit times are now older than any late edit below
    return { owner, a, b, p, t: res.body.id as string };
  }

  describe("assigned (AC1)", () => {
    it("create with assignees records one event for them, not for the creator", async () => {
      const owner = await user();
      const a = await user();
      const b = await user();
      const p = await seed(owner, [a, b]);
      const res = await createTask(a, p, { assigneeIds: [a.id, b.id, owner.id] });
      expect(res.status).toBe(201);
      const list = await events();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        type: "assigned", projectId: p, actorId: a.id, taskId: res.body.id, subjectTitle: "Mua ly",
      });
      expect(who(list[0]!)).toEqual(sorted(b, owner));
      expect(list[0]!.recipients.every((r) => r.pushState === "pending" && r.dueAt !== null)).toBe(true);
    });

    it("create without assignees, or with only the creator, records nothing", async () => {
      const owner = await user();
      const p = await seed(owner);
      await createTask(owner, p);
      await createTask(owner, p, { assigneeIds: [owner.id] });
      expect(await events()).toHaveLength(0);
    });

    it("patch records only the newly added assignees", async () => {
      const { owner, a, b, p, t } = await world({ assignB: true });
      await prisma.activityEvent.deleteMany();
      const res = await patchTask(a, p, t, {
        assignees: { value: [b.id, owner.id], editedAt: iso() },
      });
      expect(res.status).toBe(200);
      const list = await events();
      expect(list).toHaveLength(1);
      expect(list[0]!.type).toBe("assigned");
      expect(who(list[0]!)).toEqual([owner.id]);
    });

    it("patch that only removes assignees records nothing", async () => {
      const { a, b, p, t } = await world({ assignB: true });
      await prisma.activityEvent.deleteMany();
      await patchTask(a, p, t, { assignees: { value: [], editedAt: iso() } });
      expect(await events()).toHaveLength(0);
    });

    it("converting an idea to a task records assigned for its assignees", async () => {
      const owner = await user();
      const a = await user();
      const b = await user();
      const p = await seed(owner, [a, b]);
      const idea = await prisma.idea.create({
        data: { id: randomUUID(), projectId: p, authorId: a.id, title: "Dark mode", status: "accepted" },
      });
      const taskId = randomUUID();
      const res = await request(app)
        .post(`/projects/${p}/ideas/${idea.id}/task`)
        .set(...bearer(owner))
        .send({ taskId, assigneeIds: [a.id, b.id, owner.id] });
      expect(res.status).toBe(201);
      const list = await events();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ type: "assigned", taskId, actorId: owner.id, subjectTitle: "Dark mode" });
      expect(who(list[0]!)).toEqual(sorted(a, b));
    });
  });

  describe("comment (AC2)", () => {
    const comment = (u: User, p: string, t: string, body: Record<string, unknown> = {}) =>
      request(app)
        .post(`/projects/${p}/tasks/${t}/comments`)
        .set(...bearer(u))
        .send({ id: randomUUID(), text: "Ok", ...body });

    it("goes to the creator, assignees and earlier commenters, but not the author", async () => {
      const owner = await user();
      const creator = await user();
      const assignee = await user();
      const earlier = await user();
      const bystander = await user();
      const p = await seed(owner, [creator, assignee, earlier, bystander]);
      const t = (await createTask(creator, p, { assigneeIds: [assignee.id] })).body.id as string;
      await prisma.activityEvent.deleteMany();

      expect((await comment(earlier, p, t)).status).toBe(201);
      let list = await events();
      expect(list).toHaveLength(1);
      expect(who(list[0]!)).toEqual(sorted(creator, assignee));

      await prisma.activityEvent.deleteMany();
      expect((await comment(owner, p, t)).status).toBe(201);
      list = await events();
      expect(list[0]).toMatchObject({ type: "comment", taskId: t, actorId: owner.id, subjectTitle: "Mua ly" });
      expect(who(list[0]!)).toEqual(sorted(creator, assignee, earlier));
    });

    it("a comment with remindWith is recorded the same way", async () => {
      const { a, b, p, t } = await world({ assignB: true });
      await prisma.activityEvent.deleteMany();
      expect((await comment(a, p, t, { remindWith: true })).status).toBe(201);
      const list = await events();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ type: "comment", actorId: a.id });
      expect(who(list[0]!)).toEqual([b.id]);
    });

    it("repeating a comment id adds nothing", async () => {
      const { b, p, t } = await world();
      await prisma.activityEvent.deleteMany();
      const id = randomUUID();
      await comment(b, p, t, { id });
      await comment(b, p, t, { id });
      expect(await events()).toHaveLength(1);
    });

    it("an idea comment records nothing", async () => {
      const { a, b, p } = await world();
      const idea = await prisma.idea.create({ data: { id: randomUUID(), projectId: p, authorId: a.id, title: "x" } });
      await prisma.activityEvent.deleteMany();
      const res = await request(app)
        .post(`/projects/${p}/ideas/${idea.id}/comments`)
        .set(...bearer(b))
        .send({ id: randomUUID(), text: "hi" });
      expect(res.status).toBe(201);
      expect(await events()).toHaveLength(0);
    });
  });

  describe("done (AC3)", () => {
    it("records for the people involved when a task becomes done, and never for the actor", async () => {
      const { owner, a, b, p, t } = await world({ assignB: true });
      await prisma.activityEvent.deleteMany();
      expect((await setStatus(owner, p, t, "done")).status).toBe(200);
      const list = await events();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ type: "done", taskId: t, actorId: owner.id });
      expect(who(list[0]!)).toEqual(sorted(a, b));
    });

    it("todo to doing and done to todo record nothing; done again records a second event", async () => {
      const { owner, p, t } = await world();
      await prisma.activityEvent.deleteMany();
      await setStatus(owner, p, t, "doing");
      expect(await events()).toHaveLength(0);
      await setStatus(owner, p, t, "done");
      expect(await events()).toHaveLength(1);
      await setStatus(owner, p, t, "todo");
      expect(await events()).toHaveLength(1);
      await setStatus(owner, p, t, "done");
      expect(await events()).toHaveLength(2);
    });

    it("done to doing then done is a new change to done", async () => {
      const { owner, p, t } = await world();
      await setStatus(owner, p, t, "done");
      await prisma.activityEvent.deleteMany();
      await setStatus(owner, p, t, "doing");
      await setStatus(owner, p, t, "done");
      expect(await events()).toHaveLength(1);
    });

    it("done while already done records nothing", async () => {
      const { owner, p, t } = await world();
      await setStatus(owner, p, t, "done");
      await prisma.activityEvent.deleteMany();
      await setStatus(owner, p, t, "done");
      expect(await events()).toHaveLength(0);
    });
  });

  describe("idea (AC4)", () => {
    const createIdea = (u: User, p: string, id = randomUUID()) =>
      request(app).post(`/projects/${p}/ideas`).set(...bearer(u)).send({ id, title: "Tra dao" });

    it("goes to every other member, and a repeated client id adds nothing", async () => {
      const owner = await user();
      const a = await user();
      const b = await user();
      const p = await seed(owner, [a, b]);
      const id = randomUUID();
      expect((await createIdea(a, p, id)).status).toBe(201);
      const list = await events();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ type: "idea", ideaId: id, actorId: a.id, subjectTitle: "Tra dao" });
      expect(who(list[0]!)).toEqual(sorted(owner, b));
      expect((await createIdea(a, p, id)).status).toBe(200);
      expect(await events()).toHaveLength(1);
    });
  });

  describe("member joined (AC5)", () => {
    it("goes to the members already there, not the joiner", async () => {
      const owner = await user();
      const a = await user();
      const joiner = await user();
      const p = await seed(owner, [a]);
      const invite = await request(app).post(`/projects/${p}/invites`).set(...bearer(owner)).send({});
      expect(invite.status).toBe(201);
      const res = await request(app).post("/invites/join").set(...bearer(joiner)).send({ code: invite.body.code });
      expect(res.status).toBe(200);
      const list = await events();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ type: "member_joined", actorId: joiner.id, memberId: joiner.id, subjectTitle: "" });
      expect(who(list[0]!)).toEqual(sorted(owner, a));
    });
  });

  describe("who is told", () => {
    it("never includes the actor, in any path (AC6)", async () => {
      const owner = await user();
      const p = await seed(owner);
      await createTask(owner, p, { assigneeIds: [owner.id] });
      await request(app).post(`/projects/${p}/ideas`).set(...bearer(owner)).send({ id: randomUUID(), title: "x" });
      expect(await prisma.activityRecipient.count()).toBe(0);
      expect(await events()).toHaveLength(0);
    });
  });

  describe("changes that record nothing", () => {
    it("a PATCH that loses last-write-wins records nothing (AC8)", async () => {
      const { owner, b, p, t } = await world();
      await setStatus(owner, p, t, "doing");
      await patchTask(owner, p, t, { assignees: { value: [], editedAt: iso() } });
      await prisma.activityEvent.deleteMany();
      // Both older than the stored changes: rejected.
      const res = await patchTask(owner, p, t, {
        status: { value: "done", editedAt: iso(-100_000) },
        assignees: { value: [b.id], editedAt: iso(-100_000) },
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("doing");
      expect(await events()).toHaveLength(0);
    });

    it("a repeated task create with the same client id adds nothing (AC8)", async () => {
      const owner = await user();
      const a = await user();
      const p = await seed(owner, [a]);
      const id = randomUUID();
      expect((await createTask(owner, p, { id, assigneeIds: [a.id] })).status).toBe(201);
      expect((await createTask(owner, p, { id, assigneeIds: [a.id] })).status).toBe(200);
      expect(await events()).toHaveLength(1);
    });

    it("other changes record nothing (AC10)", async () => {
      const { owner, a, p, t } = await world();
      await prisma.activityEvent.deleteMany();
      const label = await prisma.label.create({
        data: {
          id: randomUUID(), projectId: p, name: "UI", nameKey: "ui", colour: "blue",
          nameEditedAt: clock.now(), colourEditedAt: clock.now(),
        },
      });
      const r = await patchTask(owner, p, t, {
        title: { value: "Khac", editedAt: iso() },
        description: { value: "mo ta", editedAt: iso() },
        due: { value: { date: "2026-02-01", time: null }, editedAt: iso() },
        labels: { value: [label.id], editedAt: iso() },
      });
      expect(r.status).toBe(200);
      const idea = await prisma.idea.create({ data: { id: randomUUID(), projectId: p, authorId: a.id, title: "x" } });
      const vote = await request(app).put(`/projects/${p}/ideas/${idea.id}/vote`).set(...bearer(owner)).send({});
      expect(vote.status).toBeLessThan(500);
      expect(await events()).toHaveLength(0);
    });
  });

  describe("late edits (AC9)", () => {
    it("an edit made 61 minutes ago is saved as late with no push time; 59 minutes is pending", async () => {
      const { owner, p, t, b } = await world();
      await prisma.activityEvent.deleteMany();
      scheduled.length = 0;
      await patchTask(owner, p, t, { assignees: { value: [b.id], editedAt: iso(-61 * MIN) } });
      let rows = await prisma.activityRecipient.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: b.id, pushState: "late", dueAt: null });
      expect(scheduled).toHaveLength(0);

      await prisma.activityEvent.deleteMany();
      await patchTask(owner, p, t, { assignees: { value: [], editedAt: iso(-60 * MIN) } });
      await patchTask(owner, p, t, { assignees: { value: [b.id], editedAt: iso(-59 * MIN) } });
      rows = await prisma.activityRecipient.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.pushState).toBe("pending");
      expect(rows[0]!.dueAt).not.toBeNull();
    });
  });

  describe("transaction (AC11)", () => {
    it("a failed request leaves no event and no change", async () => {
      const { owner, p, t } = await world();
      await prisma.activityEvent.deleteMany();
      // Status applies first, then the unknown label makes the whole request fail.
      const res = await patchTask(owner, p, t, {
        status: { value: "done", editedAt: iso() },
        labels: { value: [randomUUID()], editedAt: iso() },
      });
      expect(res.status).toBe(400);
      expect(await events()).toHaveLength(0);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).status).toBe("todo");
    });

    it("rows saved by recordActivity vanish when its transaction fails afterwards", async () => {
      const { owner, a, p, t } = await world();
      await prisma.activityEvent.deleteMany();
      await expect(
        prisma.$transaction(async (tx) => {
          await recordActivity(tx, {
            type: "done", projectId: p, actorId: owner.id, taskId: t, subjectTitle: "x",
            occurredAt: clock.now(), recipients: [a.id], now: clock.now(),
          });
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
      expect(await events()).toHaveLength(0);
      expect(await prisma.activityRecipient.count()).toBe(0);
    });
  });

  describe("push window and scheduler", () => {
    it("a second event for the same person inside the window reuses its dueAt", async () => {
      const owner = await user();
      const a = await user();
      const p = await seed(owner, [a]);
      await createTask(owner, p, { assigneeIds: [a.id] });
      clock.advanceMs(20_000);
      await request(app).post(`/projects/${p}/ideas`).set(...bearer(owner)).send({ id: randomUUID(), title: "x" });
      const rows = await prisma.activityRecipient.findMany({ where: { userId: a.id } });
      expect(rows).toHaveLength(2);
      expect(rows[0]!.dueAt!.getTime()).toBe(rows[1]!.dueAt!.getTime());
    });

    it("after the window has passed a new event opens a new one 60 seconds ahead", async () => {
      const owner = await user();
      const a = await user();
      const p = await seed(owner, [a]);
      await createTask(owner, p, { assigneeIds: [a.id] });
      clock.advanceMs(61_000);
      const before = clock.now().getTime();
      await request(app).post(`/projects/${p}/ideas`).set(...bearer(owner)).send({ id: randomUUID(), title: "x" });
      const rows = await prisma.activityRecipient.findMany({ where: { userId: a.id }, orderBy: { dueAt: "desc" } });
      expect(rows[0]!.dueAt!.getTime()).toBe(before + 60_000);
    });

    it("calls the scheduler after commit with the earliest dueAt, and not when nothing was recorded", async () => {
      const owner = await user();
      const a = await user();
      const b = await user();
      const p = await seed(owner, [a, b]);
      scheduled.length = 0;
      await createTask(owner, p); // nothing recorded
      expect(scheduled).toHaveLength(0);

      await createTask(owner, p, { assigneeIds: [a.id] });
      const first = (await prisma.activityRecipient.findFirstOrThrow({ where: { userId: a.id } })).dueAt!;
      expect(scheduled).toEqual([first]);

      clock.advanceMs(10_000);
      // a joins the open window (the same dueAt); b would get a later one. The earliest is told.
      await createTask(owner, p, { assigneeIds: [b.id, a.id] });
      expect(scheduled).toHaveLength(2);
      expect(scheduled[1]!.getTime()).toBe(first.getTime());
    });

    it("a request that fails never reaches the scheduler", async () => {
      const { owner, p, t } = await world();
      scheduled.length = 0;
      await patchTask(owner, p, t, {
        status: { value: "done", editedAt: iso() },
        labels: { value: [randomUUID()], editedAt: iso() },
      });
      expect(scheduled).toHaveLength(0);
    });
  });
});
