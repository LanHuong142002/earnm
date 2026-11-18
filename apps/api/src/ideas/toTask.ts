import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import {
  MAX_TASKS_PER_PROJECT,
  assertAssigneesAreMembers,
  assigneeIdsSchema,
  descriptionSchema,
  realDate,
  taskInclude,
  taskResponse,
  timeSchema,
  titleSchema,
} from "../tasks/routes.js";
import { lockedMember, notFound, requireIdea } from "./common.js";
import { ideaInclude, ideaResponse } from "./response.js";

// Everything but taskId is optional: the idea's own title and description are used when they are left out.
const bodySchema = z
  .object({
    taskId: z.uuid(),
    title: titleSchema.optional(),
    description: descriptionSchema.optional(),
    assigneeIds: assigneeIdsSchema.default([]),
    dueDate: realDate.nullable().default(null),
    dueTime: timeSchema.nullable().default(null),
  })
  .strict()
  .refine((b) => b.dueTime === null || b.dueDate !== null, {
    message: "A time needs a day.",
    path: ["dueTime"],
  });

/** `POST /projects/:projectId/ideas/:ideaId/task`: turns an accepted idea into a task, once. */
export function createIdeaToTaskRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const body = bodySchema.parse(req.body);
      const { taskId } = body;

      // The task, the link and the checks are one transaction under the project lock, so two
      // requests at once can't both make a task and the task limit can't be passed.
      const result = await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const idea = await tx.idea.findFirst({
          where: { id: ideaId, projectId },
          include: { labels: true },
        });
        if (!idea) throw notFound(); // deleted meanwhile
        if (idea.status !== "accepted") {
          throw new AppError(409, "idea_not_accepted", "Only an accepted idea can become a task.");
        }
        if (idea.taskId !== null) {
          throw new AppError(409, "idea_already_has_task", "This idea already has a task.");
        }
        if (await tx.task.findUnique({ where: { id: taskId }, select: { id: true } })) {
          throw new AppError(409, "id_conflict", "That task id is already taken.");
        }
        if ((await tx.task.count({ where: { projectId } })) >= MAX_TASKS_PER_PROJECT) {
          throw new AppError(
            409,
            "task_limit_reached",
            `A project can hold at most ${MAX_TASKS_PER_PROJECT} tasks.`,
          );
        }
        await assertAssigneesAreMembers(tx, projectId, body.assigneeIds);
        const at = now();
        // No photos are copied: the task starts without any (#43).
        const task = await tx.task.create({
          data: {
            id: taskId,
            projectId,
            title: body.title ?? idea.title,
            description: body.description ?? idea.description,
            dueDate: body.dueDate,
            dueTime: body.dueTime,
            status: "todo",
            titleEditedAt: at,
            descriptionEditedAt: at,
            statusEditedAt: at,
            dueEditedAt: at,
            assigneesEditedAt: at,
            labelsEditedAt: at,
            createdById: userId,
            assignees: { create: body.assigneeIds.map((id) => ({ userId: id })) },
            labels: { create: idea.labels.map((l) => ({ labelId: l.labelId })) },
          },
        });
        await tx.idea.update({ where: { id: ideaId }, data: { taskId: task.id } });
        return {
          task: await tx.task.findUniqueOrThrow({ where: { id: task.id }, include: taskInclude }),
          idea: await tx.idea.findUniqueOrThrow({ where: { id: ideaId }, include: ideaInclude }),
        };
      });
      res.status(201).json({ task: taskResponse(result.task), idea: ideaResponse(result.idea, userId) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
