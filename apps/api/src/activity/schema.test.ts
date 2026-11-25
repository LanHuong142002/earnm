import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addMember, createSignedInUser, prisma, useTestApp } from "../test/helpers.js";

// Checks the database rules from the activity migration itself (ticket #16 data model),
// so removing a cascade, SET NULL or a key makes these fail.
describe("activity schema", () => {
  const { clock } = useTestApp();

  async function makeEvent(userId: string, recipientId: string) {
    const t = clock.now();
    const project = await prisma.project.create({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Trà sữa",
        currency: "VND",
        nameEditedAt: t,
        descriptionEditedAt: t,
        currencyEditedAt: t,
      },
    });
    await addMember(project.id, userId, "owner");
    const task = await prisma.task.create({
      data: {
        id: "22222222-2222-4222-8222-222222222222",
        projectId: project.id,
        title: "Mua ly",
        titleEditedAt: t,
        descriptionEditedAt: t,
        statusEditedAt: t,
        dueEditedAt: t,
        assigneesEditedAt: t,
        labelsEditedAt: t,
        createdById: userId,
      },
    });
    const event = await prisma.activityEvent.create({
      data: {
        projectId: project.id,
        type: "assigned",
        actorId: userId,
        taskId: task.id,
        memberId: recipientId,
        subjectTitle: task.title,
        occurredAt: t,
        recipients: { create: [{ userId: recipientId, occurredAt: t }] },
      },
      include: { recipients: true },
    });
    return { project, task, event };
  }

  it("stores an event with a recipient that starts unread and pending", async () => {
    const { id: actorId } = await createSignedInUser(clock);
    const { id: otherId } = await createSignedInUser(clock);
    const { event } = await makeEvent(actorId, otherId);

    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.recipients).toHaveLength(1);
    const r = event.recipients[0];
    expect(r?.readAt).toBeNull();
    expect(r?.pushState).toBe("pending");
    expect(r?.attempts).toBe(0);
    expect(r?.dueAt).toBeNull();
    expect(r?.sentAt).toBeNull();
  });

  it("refuses the same recipient twice on one event", async () => {
    const { id: actorId } = await createSignedInUser(clock);
    const { id: otherId } = await createSignedInUser(clock);
    const { event } = await makeEvent(actorId, otherId);

    await expect(
      prisma.activityRecipient.create({
        data: { eventId: event.id, userId: otherId, occurredAt: clock.now() },
      }),
    ).rejects.toThrow();
    expect(await prisma.activityRecipient.count()).toBe(1);
  });

  it("removes a project's events and recipients when the project is deleted", async () => {
    const { id: actorId } = await createSignedInUser(clock);
    const { id: otherId } = await createSignedInUser(clock);
    const { project } = await makeEvent(actorId, otherId);
    expect(await prisma.activityEvent.count()).toBe(1);
    expect(await prisma.activityRecipient.count()).toBe(1);

    await prisma.project.delete({ where: { id: project.id } });

    expect(await prisma.activityEvent.count()).toBe(0);
    expect(await prisma.activityRecipient.count()).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: actorId } })).not.toBeNull();
  });

  it("keeps the event with taskId null when the task is deleted", async () => {
    const { id: actorId } = await createSignedInUser(clock);
    const { id: otherId } = await createSignedInUser(clock);
    const { task, event } = await makeEvent(actorId, otherId);

    await prisma.task.delete({ where: { id: task.id } });

    const after = await prisma.activityEvent.findUnique({ where: { id: event.id } });
    expect(after?.taskId).toBeNull();
    expect(after?.subjectTitle).toBe("Mua ly");
  });

  it("clears actorId and memberId when those users are deleted, and removes their recipient rows", async () => {
    const { id: actorId } = await createSignedInUser(clock);
    const { id: otherId } = await createSignedInUser(clock);
    const { event } = await makeEvent(actorId, otherId);

    await prisma.user.delete({ where: { id: actorId } });
    expect((await prisma.activityEvent.findUnique({ where: { id: event.id } }))?.actorId).toBeNull();

    await prisma.user.delete({ where: { id: otherId } });
    const after = await prisma.activityEvent.findUnique({ where: { id: event.id } });
    expect(after?.memberId).toBeNull();
    expect(await prisma.activityRecipient.count()).toBe(0);
  });

  it("clears ideaId when the idea is deleted", async () => {
    const { id: actorId } = await createSignedInUser(clock);
    const { id: otherId } = await createSignedInUser(clock);
    const { project } = await makeEvent(actorId, otherId);
    const idea = await prisma.idea.create({
      data: { id: "33333333-3333-4333-8333-333333333333", projectId: project.id, title: "Matcha" },
    });
    const ev = await prisma.activityEvent.create({
      data: {
        projectId: project.id,
        type: "idea",
        actorId,
        ideaId: idea.id,
        subjectTitle: idea.title,
        occurredAt: clock.now(),
      },
    });

    await prisma.idea.delete({ where: { id: idea.id } });

    const after = await prisma.activityEvent.findUnique({ where: { id: ev.id } });
    expect(after?.ideaId).toBeNull();
  });

  it("removes mute rows with the user or project, and refuses duplicates", async () => {
    const { id: userId } = await createSignedInUser(clock);
    const { id: otherId } = await createSignedInUser(clock);
    const { project } = await makeEvent(userId, otherId);
    await prisma.notificationTypeMute.create({ data: { userId, type: "comment" } });
    await prisma.projectNotificationMute.create({ data: { userId, projectId: project.id } });

    await expect(
      prisma.notificationTypeMute.create({ data: { userId, type: "comment" } }),
    ).rejects.toThrow();
    await expect(
      prisma.projectNotificationMute.create({ data: { userId, projectId: project.id } }),
    ).rejects.toThrow();

    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.projectNotificationMute.count()).toBe(0);
    expect(await prisma.notificationTypeMute.count()).toBe(1);

    await prisma.user.delete({ where: { id: userId } });
    expect(await prisma.notificationTypeMute.count()).toBe(0);
  });
});

// Applying the activity migration to a database that already holds users, projects and tasks.
describe("activity migration on existing data", () => {
  const migrationsDir = fileURLToPath(new URL("../../prisma/migrations/", import.meta.url));

  /** The statements of one trusted migration file; Prisma migrations end every statement with ";" at a line end. */
  function statements(folder: string): string[] {
    const sql = readFileSync(`${migrationsDir}${folder}/migration.sql`, "utf8");
    return sql
      .split(/;\s*(?:\r?\n|$)/)
      .map((part) =>
        part
          .split(/\r?\n/)
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim(),
      )
      .filter((part) => part.length > 0);
  }

  it("keeps existing rows unchanged, adds empty activity tables, and accepts a row afterwards", async () => {
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const upTo = folders.indexOf("20261120130000_drafts");
    const activityAt = folders.indexOf("20261125120000_activity");
    expect(upTo).toBeGreaterThanOrEqual(0);
    expect(activityAt).toBe(upTo + 1);

    // Generated here, never from input; checked before it goes into SQL.
    const schema = `act16_${randomBytes(6).toString("hex")}`;
    if (!/^[a-z0-9_]+$/.test(schema)) throw new Error("bad schema name");

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      const read = await prisma.$transaction(async (tx) => {
        // SET LOCAL lasts for this transaction on this one connection only.
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        for (const folder of folders.slice(0, upTo + 1)) {
          for (const statement of statements(folder)) await tx.$executeRawUnsafe(statement);
        }
        const ts = "TIMESTAMP '2026-01-01 00:00:00'";
        await tx.$executeRawUnsafe(
          `INSERT INTO "User" ("id","email","passwordHash","displayName","updatedAt")
           VALUES ('u-1','act16@example.com','x','Owner',${ts}),
                  ('u-2','act16b@example.com','x','Member',${ts})`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "Project" ("id","name","currency","nameEditedAt","descriptionEditedAt","currencyEditedAt","updatedAt")
           VALUES ('p-1','Trà sữa','VND',${ts},${ts},${ts},${ts})`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "ProjectMember" ("projectId","userId","role") VALUES ('p-1','u-1','owner'),('p-1','u-2','member')`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "Task" ("id","projectId","title","titleEditedAt","descriptionEditedAt","statusEditedAt","dueEditedAt","assigneesEditedAt","updatedAt")
           VALUES ('t-1','p-1','Mua ly',${ts},${ts},${ts},${ts},${ts},${ts})`,
        );
        const snapshot = async () => ({
          users: await tx.$queryRawUnsafe(`SELECT * FROM "User" ORDER BY "id"`),
          projects: await tx.$queryRawUnsafe(`SELECT * FROM "Project" ORDER BY "id"`),
          members: await tx.$queryRawUnsafe(`SELECT * FROM "ProjectMember" ORDER BY "userId"`),
          tasks: await tx.$queryRawUnsafe(`SELECT * FROM "Task" ORDER BY "id"`),
        });
        const before = await snapshot();

        for (const statement of statements(folders[activityAt] as string)) {
          await tx.$executeRawUnsafe(statement);
        }

        const after = await snapshot();
        const count = async (table: string) =>
          ((await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}"`)) as { n: number }[])[0]?.n;
        const counts = {
          events: await count("ActivityEvent"),
          recipients: await count("ActivityRecipient"),
          typeMutes: await count("NotificationTypeMute"),
          projectMutes: await count("ProjectNotificationMute"),
        };

        await tx.$executeRawUnsafe(
          `INSERT INTO "ActivityEvent" ("id","projectId","type","actorId","taskId","memberId","subjectTitle","occurredAt")
           VALUES ('e-1','p-1','assigned','u-1','t-1','u-2','Mua ly',${ts})`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "ActivityRecipient" ("eventId","userId","occurredAt") VALUES ('e-1','u-2',${ts})`,
        );
        const recipient = (await tx.$queryRawUnsafe(
          `SELECT "pushState"::text AS "pushState", "attempts", "readAt" FROM "ActivityRecipient"`,
        )) as { pushState: string; attempts: number; readAt: Date | null }[];

        await tx.$executeRawUnsafe(`DELETE FROM "Task" WHERE "id" = 't-1'`);
        const afterTaskDelete = (await tx.$queryRawUnsafe(
          `SELECT "taskId" FROM "ActivityEvent" WHERE "id" = 'e-1'`,
        )) as { taskId: string | null }[];

        await tx.$executeRawUnsafe(`DELETE FROM "Project" WHERE "id" = 'p-1'`);
        const eventsLeft = await count("ActivityEvent");
        const recipientsLeft = await count("ActivityRecipient");
        return { before, after, counts, recipient, afterTaskDelete, eventsLeft, recipientsLeft };
      });

      expect((read.before.users as unknown[]).length).toBe(2);
      expect((read.before.projects as unknown[]).length).toBe(1);
      expect((read.before.members as unknown[]).length).toBe(2);
      expect((read.before.tasks as unknown[]).length).toBe(1);
      expect(read.after).toEqual(read.before);
      expect(read.counts).toEqual({ events: 0, recipients: 0, typeMutes: 0, projectMutes: 0 });
      expect(read.recipient).toEqual([{ pushState: "pending", attempts: 0, readAt: null }]);
      expect(read.afterTaskDelete).toEqual([{ taskId: null }]);
      expect(read.eventsLeft).toBe(0);
      expect(read.recipientsLeft).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
