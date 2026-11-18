import type { PrismaClient } from "../../generated/prisma/client.js";

type Db = Pick<PrismaClient, "taskAssignee">;

/**
 * Whether `userId` is involved in the task right now: its creator or one of its assignees
 * (the same group Epic Decision 13 sends activity pushes to).
 */
export async function isInvolved(
  db: Db,
  task: { id: string; createdById: string | null },
  userId: string,
): Promise<boolean> {
  if (task.createdById === userId) return true;
  const assignee = await db.taskAssignee.findUnique({
    where: { taskId_userId: { taskId: task.id, userId } },
    select: { userId: true },
  });
  return assignee !== null;
}
