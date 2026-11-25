import { Router } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { multiLineText, singleLineText } from "../http/text.js";
import type { PhotoStore } from "../photos/cloudinary.js";
import { destroyImagesWithin } from "../photos/destroy.js";
import { findForMember } from "../projects/access.js";
import {
  canManage,
  change,
  forbidden,
  idSchema,
  lockedMember,
  notFound,
  param,
  requireIdea,
  withRetry,
} from "./common.js";
import { ideaInclude, ideaResponse } from "./response.js";
import { recordActivity, scheduleAfterCommit, type ActivityScheduler } from "../activity/record.js";
import { projectMembers } from "../activity/recipients.js";

/** A project holds at most this many ideas. */
export const MAX_IDEAS_PER_PROJECT = 500;

const titleSchema = singleLineText(120);
const descriptionSchema = multiLineText(2000);
const statusSchema = z.enum(["new", "considering", "accepted", "dropped"]);
const labelIdsSchema = z
  .array(z.uuid())
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, "Each label can be listed once.");

const createSchema = z
  .object({
    id: z.uuid(),
    title: titleSchema,
    description: descriptionSchema.default(""),
    labelIds: labelIdsSchema.default([]),
  })
  .strict();

const patchSchema = z
  .object({
    title: change(titleSchema).optional(),
    description: change(descriptionSchema).optional(),
    labels: change(labelIdsSchema).optional(),
    status: change(statusSchema).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

export function createIdeasRouter(deps: {
  prisma: PrismaClient;
  now: () => Date;
  /** Used to remove a deleted idea's images from Cloudinary; absent when photos are off. */
  photoStore?: PhotoStore | null;
  activityScheduler?: ActivityScheduler | null;
}): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  /** The caller's role in `:projectId`. A bad id, a missing project and a non-member all give one 404. */
  async function requireMember(rawProjectId: string | undefined, userId: string) {
    const parsed = idSchema.safeParse(rawProjectId);
    if (!parsed.success) throw notFound();
    const found = await findForMember(prisma, parsed.data, userId);
    if (!found) throw notFound();
    return { projectId: parsed.data, role: found.role };
  }

  /** Throws 400 unless every id is a label of the project. Run inside the write's transaction. */
  async function assertLabelsInProject(
    tx: Pick<PrismaClient, "label">,
    projectId: string,
    labelIds: string[],
  ): Promise<void> {
    if (labelIds.length === 0) return;
    const count = await tx.label.count({ where: { projectId, id: { in: labelIds } } });
    if (count !== labelIds.length) {
      throw new AppError(400, "validation_failed", "Invalid fields: labels.");
    }
  }

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(param(req, "projectId"), userId);
      const ideas = await prisma.idea.findMany({
        where: { projectId },
        include: ideaInclude,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      });
      res.json({ ideas: ideas.map((i) => ideaResponse(i, userId)) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:ideaId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const idea = await prisma.idea.findFirst({
        where: { id: ideaId, projectId },
        include: ideaInclude,
      });
      if (!idea) throw notFound();
      res.json(ideaResponse(idea, userId));
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId } = await requireMember(param(req, "projectId"), userId);
      const body = createSchema.parse(req.body);

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          const existing = await tx.idea.findUnique({ where: { id: body.id }, include: ideaInclude });
          if (existing) {
            if (existing.projectId !== projectId) {
              throw new AppError(409, "id_conflict", "That idea id is already taken.");
            }
            // A retry of a create the phone already sent (offline queue) answers with what was saved.
            // A body that differs from the saved idea is deliberately ignored, not an error: the idea
            // may have been edited since, and a retry must never overwrite or fail on those edits.
            return { status: 200, idea: existing, dueAt: null };
          }
          // Counted under the project lock, so concurrent creates can't pass the limit together.
          if ((await tx.idea.count({ where: { projectId } })) >= MAX_IDEAS_PER_PROJECT) {
            throw new AppError(
              409,
              "idea_limit_reached",
              `A project can hold at most ${MAX_IDEAS_PER_PROJECT} ideas.`,
            );
          }
          await assertLabelsInProject(tx, projectId, body.labelIds);
          // The field times start at the epoch: the create carries no edit time, and an edit the
          // phone queued after writing the idea must win even though the create reached us later.
          const epoch = new Date(0);
          const at = now();
          const idea = await tx.idea.create({
            data: {
              id: body.id,
              projectId,
              authorId: userId,
              title: body.title,
              description: body.description,
              titleEditedAt: epoch,
              descriptionEditedAt: epoch,
              statusEditedAt: epoch,
              labelsEditedAt: epoch,
              createdAt: at,
              labels: { create: body.labelIds.map((labelId) => ({ labelId })) },
            },
            include: ideaInclude,
          });
          const dueAt = await recordActivity(tx, {
            type: "idea",
            projectId,
            actorId: userId,
            ideaId: idea.id,
            subjectTitle: idea.title,
            occurredAt: at,
            recipients: await projectMembers(tx, projectId),
            now: at,
          });
          return { status: 201, idea, dueAt };
        }),
      );
      scheduleAfterCommit(deps.activityScheduler, result.dueAt);
      res.status(result.status).json(ideaResponse(result.idea, userId));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:ideaId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const fields = patchSchema.parse(req.body);

      // Last write wins per field, all in one transaction. The column names come from the
      // field names, so TypeScript can't check them here; the route tests do.
      await prisma.$transaction(async (tx) => {
        // The role is read again under the lock: a demotion that committed meanwhile counts.
        const role = await lockedMember(tx, projectId, userId);
        const idea = await tx.idea.findFirst({
          where: { id: ideaId, projectId },
          select: { authorId: true },
        });
        if (!idea) throw notFound(); // deleted meanwhile
        // Anyone can move an idea along; the words and labels belong to its author and the Owner.
        const touchesContent = fields.title || fields.description || fields.labels;
        if (touchesContent && !canManage(idea, userId, role)) {
          throw forbidden("Only the author or an owner can edit this idea.");
        }
        await applyLastWriteWins(fields, now(), async (where, data) => {
          const scope = { id: ideaId, projectId, ...where };
          if ("labels" in data) {
            // Claim the field's time first. Only the request that wins checks and replaces the rows.
            const claimed = await tx.idea.updateMany({
              where: scope,
              data: { labelsEditedAt: data["labelsEditedAt"] as Date },
            });
            if (claimed.count !== 1) return;
            const ids = data["labels"] as string[];
            // Throwing rolls the claim back too, so a refused set changes nothing.
            await assertLabelsInProject(tx, projectId, ids);
            await tx.ideaLabel.deleteMany({ where: { ideaId } });
            await tx.ideaLabel.createMany({ data: ids.map((labelId) => ({ ideaId, labelId })) });
            return;
          }
          await tx.idea.updateMany({ where: scope, data } as Prisma.IdeaUpdateManyArgs);
        });
      });

      // Always answer with the current state, even when every change lost.
      const current = await prisma.idea.findFirst({
        where: { id: ideaId, projectId },
        include: ideaInclude,
      });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(ideaResponse(current, userId));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:ideaId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      let publicIds: string[] = [];
      await prisma.$transaction(async (tx) => {
        const role = await lockedMember(tx, projectId, userId);
        const idea = await tx.idea.findFirst({
          where: { id: ideaId, projectId },
          select: { authorId: true },
        });
        if (!idea) throw notFound();
        // An idea whose author was removed (authorId null) can be deleted by an Owner only.
        if (!canManage(idea, userId, role)) {
          throw forbidden("Only the author or an owner can delete this idea.");
        }
        // Collected before the delete: the photo rows go with the idea by the database cascade.
        publicIds = (
          await tx.ideaPhoto.findMany({ where: { ideaId }, select: { publicId: true } })
        ).map((p) => p.publicId);
        // Comments, votes and labels are removed by the database cascade; a task made from the idea stays.
        const { count } = await tx.idea.deleteMany({ where: { id: ideaId, projectId } });
        if (count === 0) throw notFound(); // someone else deleted it first
      });
      // After the commit, so a refused or rolled-back delete never touches an image. Awaited before the
      // answer, so a crash after the commit can't silently orphan them (destroyImages never throws).
      await destroyImagesWithin(deps.photoStore, publicIds);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
