import type { PrismaClient } from "../../generated/prisma/client.js";

/** How many "Nhắc kèm" comments ride along with a reminder. */
export const REMIND_WITH_LIMIT = 3;

/**
 * The latest `REMIND_WITH_LIMIT` "Nhắc kèm" comments of each task, newest first, picked in SQL so
 * a task with hundreds of comments never loads them all.
 */
export async function latestRemindWithComments(prisma: PrismaClient, taskIds: string[]) {
  const byTask = new Map<string, { author: string | null; text: string }[]>();
  for (const taskId of taskIds) byTask.set(taskId, []);
  if (taskIds.length === 0) return byTask;
  const picked = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM (
      SELECT id, row_number() OVER (PARTITION BY "taskId" ORDER BY "createdAt" DESC, id DESC) AS rn
      FROM "TaskComment"
      WHERE "taskId" = ANY(${taskIds}) AND "remindWith"
    ) ranked
    WHERE rn <= ${REMIND_WITH_LIMIT}`;
  if (picked.length === 0) return byTask;
  const comments = await prisma.taskComment.findMany({
    where: { id: { in: picked.map((p) => p.id) } },
    include: { author: { select: { displayName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  for (const c of comments) byTask.get(c.taskId)?.push({ author: c.author?.displayName ?? null, text: c.text });
  return byTask;
}
