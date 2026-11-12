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
