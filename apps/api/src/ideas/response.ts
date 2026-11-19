import type { Prisma } from "../../generated/prisma/client.js";

export const ideaInclude = {
  author: { select: { id: true, displayName: true } },
  // Label ids come back sorted by id, so the order is stable.
  labels: { orderBy: [{ labelId: "asc" }] },
  task: { select: { id: true, title: true, status: true } },
  // Only the numbers leave the server: the response never says who voted what.
  votes: { select: { userId: true, value: true } },
  _count: { select: { comments: true, photos: true } },
} satisfies Prisma.IdeaInclude;

export type IdeaRow = Prisma.IdeaGetPayload<{ include: typeof ideaInclude }>;

/** The exact shape the mobile app expects: the score for everyone, and only the caller's own vote. */
export function ideaResponse(idea: IdeaRow, userId: string) {
  return {
    id: idea.id,
    projectId: idea.projectId,
    author: idea.author ? { id: idea.author.id, displayName: idea.author.displayName } : null,
    title: idea.title,
    description: idea.description,
    status: idea.status,
    labelIds: idea.labels.map((l) => l.labelId),
    score: idea.votes.reduce((sum, v) => sum + v.value, 0),
    myVote: idea.votes.find((v) => v.userId === userId)?.value ?? 0,
    commentCount: idea._count.comments,
    photoCount: idea._count.photos,
    taskId: idea.taskId,
    task: idea.task ? { id: idea.task.id, title: idea.task.title, status: idea.task.status } : null,
    createdAt: idea.createdAt.toISOString(),
  };
}
