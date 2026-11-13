import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { addMember, createSignedInUser, prisma, useTestApp } from "../test/helpers.js";

// Checks the database rules from the tasks migration itself (spec R11, R29, AC 11),
// so removing a cascade, SET NULL or the composite key makes these fail.
describe("task schema", () => {
  const { clock } = useTestApp();

  async function makeTask(creatorId: string, assigneeIds: string[]) {
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
    await addMember(project.id, creatorId, "owner");
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
        createdById: creatorId,
        assignees: { create: assigneeIds.map((userId) => ({ userId })) },
      },
    });
    return { project, task };
  }

  it("removes a project's tasks and assignee rows when the project is deleted", async () => {
    const { id: userId } = await createSignedInUser(clock);
    const { project } = await makeTask(userId, [userId]);
    expect(await prisma.task.count()).toBe(1);
    expect(await prisma.taskAssignee.count()).toBe(1);

    await prisma.project.delete({ where: { id: project.id } });

    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.taskAssignee.count()).toBe(0);
    expect(await prisma.user.findUnique({ where: { id: userId } })).not.toBeNull();
  });

  it("removes a user's assignee rows and clears createdById when the user is deleted", async () => {
    const { id: creatorId } = await createSignedInUser(clock);
    const { id: otherId } = await createSignedInUser(clock);
    const { task } = await makeTask(creatorId, [creatorId, otherId]);

    await prisma.user.delete({ where: { id: creatorId } });

    const after = await prisma.task.findUnique({
      where: { id: task.id },
      include: { assignees: true },
    });
    expect(after).not.toBeNull();
    expect(after?.createdById).toBeNull();
    expect(after?.assignees.map((a) => a.userId)).toEqual([otherId]);
  });

  it("refuses the same assignee twice on one task", async () => {
    const { id: userId } = await createSignedInUser(clock);
    const { task } = await makeTask(userId, [userId]);

    await expect(
      prisma.taskAssignee.create({ data: { taskId: task.id, userId } }),
    ).rejects.toThrow();
    expect(await prisma.taskAssignee.count()).toBe(1);
  });
});

// Checks the database rules from the checklists and labels migration (spec R3, R7, R23, AC 23).
describe("checklist and label schema", () => {
  const { clock } = useTestApp();

  async function makeProjectWithTask() {
    const { id: userId } = await createSignedInUser(clock);
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
      },
    });
    return { project, task };
  }

  function makeLabel(projectId: string, id: string, nameKey: string) {
    const t = clock.now();
    return prisma.label.create({
      data: { id, projectId, name: nameKey, nameKey, colour: "teal", nameEditedAt: t, colourEditedAt: t },
    });
  }

  function makeChecklist(taskId: string) {
    const t = clock.now();
    return prisma.checklist.create({
      data: {
        id: "33333333-3333-4333-8333-333333333333",
        taskId,
        name: "Chuẩn bị",
        nameEditedAt: t,
        items: {
          create: [
            { id: "44444444-4444-4444-8444-444444444441", text: "a", textEditedAt: t, doneEditedAt: t },
            { id: "44444444-4444-4444-8444-444444444442", text: "b", textEditedAt: t, doneEditedAt: t },
          ],
        },
      },
    });
  }

  it("removes a task's checklists and their items when the task is deleted", async () => {
    const { task } = await makeProjectWithTask();
    await makeChecklist(task.id);
    expect(await prisma.checklistItem.count()).toBe(2);

    await prisma.task.delete({ where: { id: task.id } });

    expect(await prisma.checklist.count()).toBe(0);
    expect(await prisma.checklistItem.count()).toBe(0);
  });

  it("removes a checklist's items when the checklist is deleted, keeping the task", async () => {
    const { task } = await makeProjectWithTask();
    const checklist = await makeChecklist(task.id);

    await prisma.checklist.delete({ where: { id: checklist.id } });

    expect(await prisma.checklistItem.count()).toBe(0);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });

  it("defaults a new checklist item to not done", async () => {
    const { task } = await makeProjectWithTask();
    await makeChecklist(task.id);
    const items = await prisma.checklistItem.findMany();
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.done === false)).toBe(true);
  });

  it("removes a label's task links when the label is deleted, keeping the task", async () => {
    const { project, task } = await makeProjectWithTask();
    const label = await makeLabel(project.id, "55555555-5555-4555-8555-555555555551", "bug");
    await prisma.taskLabel.create({ data: { taskId: task.id, labelId: label.id } });

    await prisma.label.delete({ where: { id: label.id } });

    expect(await prisma.taskLabel.count()).toBe(0);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
  });

  it("removes a task's label links when the task is deleted, keeping the label", async () => {
    const { project, task } = await makeProjectWithTask();
    const label = await makeLabel(project.id, "55555555-5555-4555-8555-555555555551", "bug");
    await prisma.taskLabel.create({ data: { taskId: task.id, labelId: label.id } });

    await prisma.task.delete({ where: { id: task.id } });

    expect(await prisma.taskLabel.count()).toBe(0);
    expect(await prisma.label.findUnique({ where: { id: label.id } })).not.toBeNull();
  });

  it("refuses the same label twice on one task", async () => {
    const { project, task } = await makeProjectWithTask();
    const label = await makeLabel(project.id, "55555555-5555-4555-8555-555555555551", "bug");
    await prisma.taskLabel.create({ data: { taskId: task.id, labelId: label.id } });

    await expect(
      prisma.taskLabel.create({ data: { taskId: task.id, labelId: label.id } }),
    ).rejects.toThrow();
    expect(await prisma.taskLabel.count()).toBe(1);
  });

  it("removes a project's labels when the project is deleted", async () => {
    const { project } = await makeProjectWithTask();
    await makeLabel(project.id, "55555555-5555-4555-8555-555555555551", "bug");

    await prisma.project.delete({ where: { id: project.id } });

    expect(await prisma.label.count()).toBe(0);
  });

  it("refuses two labels with the same name key in one project, allows it in another", async () => {
    const { project } = await makeProjectWithTask();
    const t = clock.now();
    const other = await prisma.project.create({
      data: {
        id: "11111111-1111-4111-8111-111111111112",
        name: "Khác",
        currency: "USD",
        nameEditedAt: t,
        descriptionEditedAt: t,
        currencyEditedAt: t,
      },
    });
    await makeLabel(project.id, "55555555-5555-4555-8555-555555555551", "bug");

    await expect(
      makeLabel(project.id, "55555555-5555-4555-8555-555555555552", "bug"),
    ).rejects.toThrow();
    await expect(
      makeLabel(other.id, "55555555-5555-4555-8555-555555555553", "bug"),
    ).resolves.toBeTruthy();
    expect(await prisma.label.count()).toBe(2);
  });

  it("refuses a colour outside the palette", async () => {
    const { project } = await makeProjectWithTask();
    const t = clock.now();
    await expect(
      prisma.label.create({
        data: {
          id: "55555555-5555-4555-8555-555555555551",
          projectId: project.id,
          name: "x",
          nameKey: "x",
          colour: "pink" as never,
          nameEditedAt: t,
          colourEditedAt: t,
        },
      }),
    ).rejects.toThrow();
  });
});

// AC 23: applying the checklists and labels migration to a database that already holds a task.
describe("checklists and labels migration on existing data", () => {
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

  it("sets an existing task's labelsEditedAt to its createdAt and keeps the task", async () => {
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const tasksAt = folders.indexOf("20261112060000_tasks");
    const labelsAt = tasksAt + 1;
    expect(tasksAt).toBeGreaterThanOrEqual(0);
    expect(folders[labelsAt]).toMatch(/^\d{14}_checklists_labels$/);

    // Generated here, never from input; checked before it goes into SQL.
    const schema = `ac23_${randomBytes(6).toString("hex")}`;
    if (!/^[a-z0-9_]+$/.test(schema)) throw new Error("bad schema name");

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    try {
      const read = await prisma.$transaction(async (tx) => {
        // SET LOCAL lasts for this transaction on this one connection only.
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
        for (const folder of folders.slice(0, tasksAt + 1)) {
          for (const statement of statements(folder)) await tx.$executeRawUnsafe(statement);
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "Project" ("id","name","currency","nameEditedAt","descriptionEditedAt","currencyEditedAt","updatedAt")
           VALUES ('p-1','Trà sữa','VND',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00')`,
        );
        await tx.$executeRawUnsafe(
          `INSERT INTO "Task" ("id","projectId","title","titleEditedAt","descriptionEditedAt","statusEditedAt","dueEditedAt","assigneesEditedAt","createdAt","updatedAt")
           VALUES ('t-1','p-1','Mua ly',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-03-05 10:11:12',TIMESTAMP '2026-03-05 10:11:12')`,
        );

        for (const statement of statements(folders[labelsAt] as string)) {
          await tx.$executeRawUnsafe(statement);
        }

        const rows = (await tx.$queryRawUnsafe(
          `SELECT "title", "createdAt" = "labelsEditedAt" AS same FROM "Task"`,
        )) as { title: string; same: boolean }[];

        // Later migrations, then an insert that omits labelsEditedAt, as the previous server version does
        // while a new migration runs ahead of its deploy: the column must keep a default.
        for (const folder of folders.slice(labelsAt + 1)) {
          for (const statement of statements(folder)) await tx.$executeRawUnsafe(statement);
        }
        await tx.$executeRawUnsafe(
          `INSERT INTO "Task" ("id","projectId","title","titleEditedAt","descriptionEditedAt","statusEditedAt","dueEditedAt","assigneesEditedAt","updatedAt")
           VALUES ('t-2','p-1','Old code',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00',TIMESTAMP '2026-01-01 00:00:00')`,
        );
        const oldCode = (await tx.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM "Task" WHERE "id" = 't-2' AND "labelsEditedAt" IS NOT NULL`,
        )) as { n: number }[];
        const checklists = (await tx.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM "Checklist"`,
        )) as { n: number }[];
        return { rows, checklists, oldCode };
      });

      expect(read.rows).toEqual([{ title: "Mua ly", same: true }]);
      expect(read.checklists[0]?.n).toBe(0);
      expect(read.oldCode[0]?.n).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  });
});
