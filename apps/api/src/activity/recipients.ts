import type { PrismaClient } from "../../generated/prisma/client.js";

type Db = Pick<PrismaClient, "task" | "taskAssignee" | "taskComment" | "projectMember">;

/**
 * Everyone involved in a task: its creator, its assignees and whoever commented on it so far.
 * Call it before inserting a new comment, so the new author isn't counted as an earlier one
 * (the actor is removed from the recipients anyway).
 */
export async function taskPeople(tx: Db, taskId: string): Promise<string[]> {
  const [task, assignees, comments] = await Promise.all([
    tx.task.findUnique({ where: { id: taskId }, select: { createdById: true } }),
    tx.taskAssignee.findMany({ where: { taskId }, select: { userId: true } }),
    tx.taskComment.findMany({
      where: { taskId, authorId: { not: null } },
      select: { authorId: true },
      distinct: ["authorId"],
    }),
  ]);
  const ids = new Set<string>();
  if (task?.createdById) ids.add(task.createdById);
  for (const a of assignees) ids.add(a.userId);
  for (const c of comments) if (c.authorId) ids.add(c.authorId);
  return [...ids];
}

/** Everyone who is a member of the project right now. */
export async function projectMembers(tx: Db, projectId: string): Promise<string[]> {
  const rows = await tx.projectMember.findMany({ where: { projectId }, select: { userId: true } });
  return rows.map((r) => r.userId);
}
