import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { addMember, createSignedInUser, expectError, prisma, useTestApp } from "../test/helpers.js";
import { MAX_REMINDERS_PER_TASK, MAX_REMINDER_RECIPIENTS } from "./routes.js";

describe("reminders", () => {
  const { app, clock } = useTestApp();

  const bearer = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];
  const iso = (offsetMs = 0) => new Date(clock.now().getTime() + offsetMs).toISOString();
  type User = { id: string; token: string };
  const user = () => createSignedInUser(clock);

  async function seedTask(projectId: string, createdById: string) {
    const at = clock.now();
    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        projectId,
        title: "T",
        titleEditedAt: at,
        descriptionEditedAt: at,
        statusEditedAt: at,
        dueEditedAt: at,
        assigneesEditedAt: at,
        labelsEditedAt: at,
        createdById,
      },
    });
    return task.id;
  }

  async function seedProject(owner: User, members: User[]) {
    const t = clock.now();
    const project = await prisma.project.create({
      data: { id: randomUUID(), name: "P", currency: "VND", nameEditedAt: t, descriptionEditedAt: t, currencyEditedAt: t },
    });
    await addMember(project.id, owner.id, "owner");
    for (const m of members) await addMember(project.id, m.id, "member");
    return project.id;
  }

  /** owner, alice (creator), bob (member), stranger (not a member). */
  async function world() {
    const owner = await user();
    const alice = await user();
    const bob = await user();
    const stranger = await user();
    const p = await seedProject(owner, [alice, bob]);
    const t = await seedTask(p, alice.id);
    // Edit times are clamped to server time, so give the tests a past to edit in.
    clock.advanceMs(10_000);
    return { owner, alice, bob, stranger, p, t };
  }

  const base = (p: string, t: string) => `/projects/${p}/tasks/${t}/reminders`;
  const futureDate = () => new Date(clock.now().getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const schedule = (patch: Record<string, unknown> = {}) => ({
    startDate: futureDate(),
    time: "09:00",
    timezone: "Asia/Ho_Chi_Minh",
    repeat: "once",
    weekdays: [],
    endDate: null,
    ...patch,
  });
  const create = (u: User, p: string, t: string, recipientIds: string[], patch: Record<string, unknown> = {}) =>
    request(app)
      .post(base(p, t))
      .set(...bearer(u.token))
      .send({ id: randomUUID(), ...schedule(), recipientIds, ...patch });
  const list = (u: User, p: string) => request(app).get(`/projects/${p}/reminders`).set(...bearer(u.token));
  const patch = (u: User, p: string, t: string, r: string, body: Record<string, unknown>) =>
    request(app)
      .patch(`${base(p, t)}/${r}`)
      .set(...bearer(u.token))
      .send(body);
  const del = (u: User, p: string, t: string, r: string) =>
    request(app).delete(`${base(p, t)}/${r}`).set(...bearer(u.token));

  it("exports the limits", () => {
    expect(MAX_REMINDERS_PER_TASK).toBe(5);
    expect(MAX_REMINDER_RECIPIENTS).toBe(20);
  });

  // AC1
  it("creates a reminder of each repeat rule and returns every field", async () => {
    const w = await world();
    const rules = [
      schedule({ repeat: "once" }),
      schedule({ repeat: "daily", endDate: "2099-01-01" }),
      schedule({ repeat: "weekly", weekdays: [1, 3] }),
      schedule({ repeat: "monthly", startDate: "2099-01-31" }),
    ];
    for (const r of rules) {
      const id = randomUUID();
      const res = await request(app)
        .post(base(w.p, w.t))
        .set(...bearer(w.alice.token))
        .send({ id, ...r, recipientIds: [w.bob.id, w.alice.id] });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id,
        taskId: w.t,
        ...r,
        recipientIds: [w.bob.id, w.alice.id].sort(),
        createdById: w.alice.id,
        changedAt: iso(),
      });
    }
    const all = await list(w.bob, w.p);
    expect(all.status).toBe(200);
    expect(all.body.reminders).toHaveLength(4);
  });

  // AC3
  it("refuses an end date before the start date, and accepts the same day", async () => {
    const w = await world();
    const start = futureDate();
    expectError(
      await create(w.alice, w.p, w.t, [w.alice.id], { repeat: "daily", endDate: "2020-01-01" }),
      400,
      "validation_failed",
    );
    expect((await create(w.alice, w.p, w.t, [w.alice.id], { repeat: "daily", endDate: start })).status).toBe(201);
  });

  it("refuses weekly without weekdays, weekdays on other rules, and malformed fields", async () => {
    const w = await world();
    const bad: Record<string, unknown>[] = [
      { repeat: "weekly", weekdays: [] },
      { repeat: "daily", weekdays: [1] },
      { repeat: "weekly", weekdays: [7] },
      { repeat: "weekly", weekdays: [1, 1] },
      { time: "9:00" },
      { time: "24:00" },
      { startDate: "2099-02-30" },
      { timezone: "Not/AZone" },
      { extra: true },
    ];
    for (const b of bad) {
      expectError(await create(w.alice, w.p, w.t, [w.alice.id], b), 400, "validation_failed");
    }
  });

  // AC4
  it("refuses 0 or 21 recipients and a non-member recipient", async () => {
    const w = await world();
    expectError(await create(w.alice, w.p, w.t, []), 400, "validation_failed");
    const many = Array.from({ length: MAX_REMINDER_RECIPIENTS + 1 }, () => randomUUID());
    expectError(await create(w.alice, w.p, w.t, many), 400, "validation_failed");
    expectError(await create(w.alice, w.p, w.t, [w.stranger.id]), 400, "validation_failed");
    expectError(await create(w.alice, w.p, w.t, [w.alice.id, w.stranger.id]), 400, "validation_failed");
    expect(await prisma.taskReminder.count()).toBe(0);
  });

  it("accepts exactly 20 recipients", async () => {
    const w = await world();
    const extra: User[] = [];
    for (let i = 0; i < MAX_REMINDER_RECIPIENTS - 1; i++) extra.push(await user());
    for (const m of extra) await addMember(w.p, m.id, "member");
    const res = await create(w.alice, w.p, w.t, [w.alice.id, ...extra.map((m) => m.id)]);
    expect(res.status).toBe(201);
    expect(res.body.recipientIds).toHaveLength(20);
  });

  // AC6
  it("refuses a past one-off on create and on a time change, but not a repeating one", async () => {
    const w = await world();
    const past = { startDate: "2025-01-01" };
    expectError(await create(w.alice, w.p, w.t, [w.alice.id], past), 400, "validation_failed");
    expect((await create(w.alice, w.p, w.t, [w.alice.id], { ...past, repeat: "daily" })).status).toBe(201);

    const ok = await create(w.alice, w.p, w.t, [w.alice.id]);
    expect(ok.status).toBe(201);
    const res = await patch(w.alice, w.p, w.t, ok.body.id, {
      schedule: { value: schedule({ startDate: "2025-01-01" }), editedAt: iso() },
    });
    expectError(res, 400, "validation_failed");
    const after = await prisma.taskReminder.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(after.startDate.toISOString().slice(0, 10)).toBe(futureDate());
  });

  it("does not refuse an unchanged schedule whose one-off time has since passed", async () => {
    const w = await world();
    const created = await create(w.alice, w.p, w.t, [w.alice.id]);
    const same = schedule();
    clock.advanceMs(30 * 86_400_000);
    const res = await patch(w.bob, w.p, w.t, created.body.id, {
      schedule: { value: same, editedAt: iso() },
      recipients: { value: [w.bob.id], editedAt: iso() },
    });
    expect(res.status).toBe(200);
    expect(res.body.recipientIds).toEqual([w.bob.id]);
  });

  // AC7
  it("refuses the 6th reminder with reminder_limit_reached", async () => {
    const w = await world();
    for (let i = 0; i < MAX_REMINDERS_PER_TASK; i++) {
      expect((await create(w.alice, w.p, w.t, [w.alice.id])).status).toBe(201);
    }
    expectError(await create(w.alice, w.p, w.t, [w.alice.id]), 409, "reminder_limit_reached");
    // Another task has its own five.
    const t2 = await seedTask(w.p, w.alice.id);
    expect((await create(w.alice, w.p, t2, [w.alice.id])).status).toBe(201);
  });

  // AC8
  it("lets a member who did not create the reminder edit and delete it", async () => {
    const w = await world();
    const created = await create(w.alice, w.p, w.t, [w.alice.id]);
    const edited = await patch(w.bob, w.p, w.t, created.body.id, {
      schedule: { value: schedule({ time: "10:30", repeat: "daily" }), editedAt: iso() },
    });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ time: "10:30", repeat: "daily", createdById: w.alice.id });
    expect((await del(w.bob, w.p, w.t, created.body.id)).status).toBe(204);
    expectError(await del(w.bob, w.p, w.t, created.body.id), 404, "not_found");
    expect(await prisma.taskReminder.count()).toBe(0);
  });

  // AC11
  it("deletes reminders with their task and with their project", async () => {
    const w = await world();
    await create(w.alice, w.p, w.t, [w.alice.id]);
    expect(
      (await request(app).delete(`/projects/${w.p}/tasks/${w.t}`).set(...bearer(w.alice.token))).status,
    ).toBe(204);
    expect(await prisma.taskReminder.count()).toBe(0);
    expect(await prisma.taskReminderRecipient.count()).toBe(0);

    const t2 = await seedTask(w.p, w.alice.id);
    await create(w.alice, w.p, t2, [w.alice.id, w.bob.id]);
    expect(await prisma.taskReminderRecipient.count()).toBe(2);
    expect((await request(app).delete(`/projects/${w.p}`).set(...bearer(w.owner.token))).status).toBe(204);
    expect(await prisma.taskReminder.count()).toBe(0);
    expect(await prisma.taskReminderRecipient.count()).toBe(0);
  });

  it("drops a removed member, or one who leaves, from the project's reminders only", async () => {
    const w = await world();
    const other = await seedProject(w.owner, [w.bob]);
    const otherTask = await seedTask(other, w.owner.id);
    const mine = await create(w.alice, w.p, w.t, [w.alice.id, w.bob.id]);
    const theirs = await create(w.owner, other, otherTask, [w.bob.id]);

    expect(
      (await request(app).delete(`/projects/${w.p}/members/${w.bob.id}`).set(...bearer(w.owner.token))).status,
    ).toBe(204);
    const after = await list(w.alice, w.p);
    expect(after.body.reminders[0].recipientIds).toEqual([w.alice.id]);
    expect(mine.status).toBe(201);
    // The same person's other project is untouched.
    expect((await list(w.owner, other)).body.reminders[0].recipientIds).toEqual([w.bob.id]);
    expect(theirs.status).toBe(201);

    expect((await request(app).post(`/projects/${other}/leave`).set(...bearer(w.bob.token))).status).toBe(204);
    expect((await list(w.owner, other)).body.reminders[0].recipientIds).toEqual([]);
  });

  // AC12
  it("resolves edits last-write-wins per field", async () => {
    const w = await world();
    const created = await create(w.alice, w.p, w.t, [w.alice.id]);
    const id = created.body.id;

    const newer = await patch(w.alice, w.p, w.t, id, {
      schedule: { value: schedule({ time: "11:00" }), editedAt: iso(-1_000) },
    });
    expect(newer.body.time).toBe("11:00");

    // An older schedule edit loses; a recipients edit is a separate field and still wins.
    const mixed = await patch(w.bob, w.p, w.t, id, {
      schedule: { value: schedule({ time: "07:00" }), editedAt: iso(-5_000) },
      recipients: { value: [w.bob.id], editedAt: iso(-2_000) },
    });
    expect(mixed.status).toBe(200);
    expect(mixed.body.time).toBe("11:00");
    expect(mixed.body.recipientIds).toEqual([w.bob.id]);

    const older = await patch(w.alice, w.p, w.t, id, {
      recipients: { value: [w.alice.id], editedAt: iso(-3_000) },
    });
    expect(older.body.recipientIds).toEqual([w.bob.id]);

    // A phone clock in the future is clamped to server time, so it can't win forever.
    const future = await patch(w.alice, w.p, w.t, id, {
      recipients: { value: [w.alice.id], editedAt: iso(86_400_000) },
    });
    expect(future.body.recipientIds).toEqual([w.alice.id]);
    const back = await patch(w.bob, w.p, w.t, id, {
      recipients: { value: [w.bob.id], editedAt: iso(1_000) },
    });
    expect(back.body.recipientIds).toEqual([w.alice.id]);
  });

  it("sets changedAt on a winning edit, not on a losing one", async () => {
    const w = await world();
    const created = await create(w.alice, w.p, w.t, [w.alice.id]);
    clock.advanceMs(60_000);
    const lost = await patch(w.alice, w.p, w.t, created.body.id, {
      recipients: { value: [w.bob.id], editedAt: new Date(0).toISOString() },
    });
    expect(lost.body.changedAt).toBe(created.body.changedAt);
    const won = await patch(w.alice, w.p, w.t, created.body.id, {
      recipients: { value: [w.bob.id], editedAt: iso(-1) },
    });
    expect(won.body.changedAt).toBe(iso());
  });

  it("validates a patch: empty, unknown fields, and non-member recipients", async () => {
    const w = await world();
    const created = await create(w.alice, w.p, w.t, [w.alice.id]);
    expectError(await patch(w.alice, w.p, w.t, created.body.id, {}), 400, "validation_failed");
    expectError(await patch(w.alice, w.p, w.t, created.body.id, { time: "10:00" }), 400, "validation_failed");
    expectError(
      await patch(w.alice, w.p, w.t, created.body.id, {
        recipients: { value: [w.stranger.id], editedAt: iso() },
      }),
      400,
      "validation_failed",
    );
    expectError(
      await patch(w.alice, w.p, w.t, created.body.id, {
        schedule: { value: schedule({ repeat: "daily", endDate: "2000-01-01" }), editedAt: iso() },
      }),
      400,
      "validation_failed",
    );
  });

  it("is idempotent on the same id and the same task, and 409 on another task", async () => {
    const w = await world();
    const id = randomUUID();
    const send = (t: string) =>
      request(app)
        .post(base(w.p, t))
        .set(...bearer(w.alice.token))
        .send({ id, ...schedule(), recipientIds: [w.alice.id] });
    expect((await send(w.t)).status).toBe(201);
    const again = await send(w.t);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);
    expect(await prisma.taskReminder.count()).toBe(1);

    const t2 = await seedTask(w.p, w.alice.id);
    expectError(await send(t2), 409, "id_conflict");

    // The same id from another project's task is the same 409, never a leak of its contents.
    const owner2 = await user();
    const p2 = await seedProject(owner2, []);
    const t3 = await seedTask(p2, owner2.id);
    const res = await request(app)
      .post(base(p2, t3))
      .set(...bearer(owner2.token))
      .send({ id, ...schedule(), recipientIds: [owner2.id] });
    expectError(res, 409, "id_conflict");
  });

  it("answers a retry of a past one-off create with the existing reminder", async () => {
    const w = await world();
    const id = randomUUID();
    const body = { id, ...schedule(), recipientIds: [w.alice.id] };
    const first = await request(app).post(base(w.p, w.t)).set(...bearer(w.alice.token)).send(body);
    expect(first.status).toBe(201);
    clock.advanceMs(30 * 86_400_000);
    const retry = await request(app).post(base(w.p, w.t)).set(...bearer(w.alice.token)).send(body);
    expect(retry.status).toBe(200);
  });

  // AC13
  it("answers 404 to non-members and 401 when signed out, for list, create, edit and delete", async () => {
    const w = await world();
    const created = await create(w.alice, w.p, w.t, [w.alice.id]);
    const id = created.body.id;

    expectError(await list(w.stranger, w.p), 404, "not_found");
    expectError(await request(app).get(base(w.p, w.t)).set(...bearer(w.stranger.token)), 404, "not_found");
    expectError(await create(w.stranger, w.p, w.t, [w.alice.id]), 404, "not_found");
    expectError(
      await patch(w.stranger, w.p, w.t, id, { recipients: { value: [w.alice.id], editedAt: iso() } }),
      404,
      "not_found",
    );
    expectError(await del(w.stranger, w.p, w.t, id), 404, "not_found");
    // A task id from another project, or a made-up one, looks the same.
    expectError(await create(w.alice, w.p, randomUUID(), [w.alice.id]), 404, "not_found");
    expectError(await del(w.alice, w.p, w.t, randomUUID()), 404, "not_found");

    expectError(await request(app).get(`/projects/${w.p}/reminders`), 401, "not_signed_in");
    expectError(await request(app).get(base(w.p, w.t)), 401, "not_signed_in");
    expectError(await request(app).post(base(w.p, w.t)).send({}), 401, "not_signed_in");
    expectError(await request(app).patch(`${base(w.p, w.t)}/${id}`).send({}), 401, "not_signed_in");
    expectError(await request(app).delete(`${base(w.p, w.t)}/${id}`), 401, "not_signed_in");
    expect(await prisma.taskReminder.count()).toBe(1);
  });

  it("lists every reminder in the project across tasks, for any member", async () => {
    const w = await world();
    const t2 = await seedTask(w.p, w.alice.id);
    await create(w.alice, w.p, w.t, [w.alice.id]);
    await create(w.alice, w.p, t2, [w.bob.id]);
    const res = await list(w.bob, w.p);
    expect(res.status).toBe(200);
    expect(res.body.reminders.map((r: { taskId: string }) => r.taskId).sort()).toEqual([w.t, t2].sort());
  });

  // remindWith embed
  it("embeds each task's latest 3 flagged comments, newest first", async () => {
    const w = await world();
    const t2 = await seedTask(w.p, w.alice.id);
    await create(w.alice, w.p, w.t, [w.alice.id]);
    await create(w.alice, w.p, t2, [w.alice.id]);
    const comment = (taskId: string, text: string, remindWith: boolean, at: number, authorId: string | null) =>
      prisma.taskComment.create({
        data: { id: randomUUID(), taskId, authorId, text, remindWith, createdAt: new Date(at) },
      });
    const base0 = clock.now().getTime();
    await comment(w.t, "one", true, base0 + 1_000, w.alice.id);
    await comment(w.t, "unflagged", false, base0 + 2_000, w.alice.id);
    await comment(w.t, "two", true, base0 + 3_000, w.bob.id);
    await comment(w.t, "three", true, base0 + 4_000, null);
    await comment(w.t, "four", true, base0 + 5_000, w.alice.id);
    // Not embedded: t2 has no flagged comment, and tasks without reminders aren't listed.
    const t3 = await seedTask(w.p, w.alice.id);
    await comment(t3, "ignored", true, base0, w.alice.id);

    const res = await list(w.bob, w.p);
    expect(res.body.remindWith).toEqual({
      [w.t]: [
        { author: "Bob", text: "four" },
        { author: null, text: "three" },
        { author: "Bob", text: "two" },
      ],
      [t2]: [],
    });
  });
});
