import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { multiLineText } from "../http/text.js";
import { findForMember, lockProject } from "../projects/access.js";
import { isInvolved } from "../tasks/involved.js";
import { UPLOAD_TYPE, type PhotoStore } from "./cloudinary.js";
import { destroyImages } from "./destroy.js";

/** A task holds at most this many photos. */
export const MAX_PHOTOS_PER_TASK = 10;
/** A caption is at most this many characters after trimming. */
export const MAX_CAPTION_LENGTH = 200;
/** Larger than any phone photo after the 1600 px shrink; only a sanity bound. */
const MAX_DIMENSION = 20000;

const captionSchema = multiLineText(MAX_CAPTION_LENGTH);
// Accepts "Z" and offsets such as "+07:00".
const editedAtSchema = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const signSchema = z.object({ id: z.uuid() }).strict();

const recordSchema = z
  .object({
    id: z.uuid(),
    publicId: z.string().max(300),
    width: z.number().int().min(1).max(MAX_DIMENSION),
    height: z.number().int().min(1).max(MAX_DIMENSION),
    caption: captionSchema.optional(),
  })
  .strict();

/** One field change from the phone: the new value and when the person made it. */
const change = <T extends z.ZodType>(value: T) => z.object({ value, editedAt: editedAtSchema }).strict();

const patchSchema = z.object({ caption: change(captionSchema) }).strict();

const idSchema = z.uuid();

const order = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.TaskPhotoOrderByWithRelationInput[];
const include = {
  addedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.TaskPhotoInclude;
type PhotoRow = Prisma.TaskPhotoGetPayload<{ include: typeof include }>;

/** The exact shape the mobile app expects. The image addresses are signed and only built here. */
function photoResponse(store: PhotoStore, p: PhotoRow) {
  return {
    id: p.id,
    taskId: p.taskId,
    addedBy: p.addedBy ? { id: p.addedBy.id, displayName: p.addedBy.displayName } : null,
    caption: p.caption,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt.toISOString(),
    thumbUrl: store.thumbUrl(p.publicId),
    url: store.url(p.publicId),
  };
}

/** Where a photo of this task lives on Cloudinary: fixed by the server, never chosen by the phone. */
export function photoPublicId(projectId: string, taskId: string, photoId: string): string {
  return `earnm/${projectId}/${taskId}/${photoId}`;
}

/** Route params, including the ones merged in from the parent mount. */
function param(req: Request, name: string): string | undefined {
  return (req.params as Record<string, string | undefined>)[name];
}

/** One 404 for every "no such thing for you" case, so the body never reveals which it was. */
function notFound(): AppError {
  return new AppError(404, "not_found", "Project not found.");
}

function forbidden(message: string): AppError {
  return new AppError(403, "forbidden", message);
}

function limitReached(): AppError {
  return new AppError(409, "photo_limit_reached", `A task can hold at most ${MAX_PHOTOS_PER_TASK} photos.`);
}

type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

export function createPhotosRouter(deps: {
  prisma: PrismaClient;
  now: () => Date;
  /** Null or absent when Cloudinary isn't configured: every route then answers 503. */
  photoStore?: PhotoStore | null;
}): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  /** The store, or the 503 that says photos are off. Runs after sign-in, so signed-out callers still get 401. */
  function requireStore(): PhotoStore {
    if (!deps.photoStore) {
      throw new AppError(503, "photos_unavailable", "Photos are not available right now.");
    }
    return deps.photoStore;
  }

  /** The caller's membership in `:projectId`, and the task in it. Every miss gives the same 404. */
  async function requireTask(req: Request, userId: string) {
    const projectId = idSchema.safeParse(param(req, "projectId"));
    const taskId = idSchema.safeParse(param(req, "taskId"));
    if (!projectId.success || !taskId.success) throw notFound();
    if (!(await findForMember(prisma, projectId.data, userId))) throw notFound();
    const task = await prisma.task.findFirst({
      where: { id: taskId.data, projectId: projectId.data },
      select: { id: true },
    });
    if (!task) throw notFound();
    return { projectId: projectId.data, taskId: task.id };
  }

  /**
   * `requireTask` for the record route. When the caller is a member and only the task is gone, the
   * image they uploaded after signing can never be recorded, so it is removed in the background.
   */
  async function requireTaskOrDestroyUpload(req: Request, userId: string, store: PhotoStore) {
    try {
      return await requireTask(req, userId);
    } catch (err) {
      const projectId = idSchema.safeParse(param(req, "projectId"));
      const taskId = idSchema.safeParse(param(req, "taskId"));
      const photoId = idSchema.safeParse((req.body as { id?: unknown } | undefined)?.id);
      if (projectId.success && taskId.success && photoId.success) {
        const member = await findForMember(prisma, projectId.data, userId);
        const task = member
          ? await prisma.task.findFirst({
              where: { id: taskId.data, projectId: projectId.data },
              select: { id: true },
            })
          : null;
        if (member && !task) {
          void destroyImages(store, [photoPublicId(projectId.data, taskId.data, photoId.data)]);
        }
      }
      throw err;
    }
  }

  /** The photo on this task, or a 404 that looks the same whether it's missing or elsewhere. */
  async function requirePhoto(req: Request, taskId: string) {
    const parsed = idSchema.safeParse(param(req, "photoId"));
    if (!parsed.success) throw notFound();
    const photo = await prisma.taskPhoto.findFirst({
      where: { id: parsed.data, taskId },
      select: { id: true },
    });
    if (!photo) throw notFound();
    return photo.id;
  }

  /** Takes the project lock and re-checks the caller's membership under it. */
  async function lockedMember(tx: Tx, projectId: string, userId: string) {
    if (!(await lockProject(tx, projectId))) throw notFound();
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw notFound();
  }

  /** The task as it is under the lock, or the same 404. */
  async function lockedTask(tx: Tx, projectId: string, taskId: string) {
    const task = await tx.task.findFirst({
      where: { id: taskId, projectId },
      select: { id: true, createdById: true },
    });
    if (!task) throw notFound();
    return task;
  }

  /** Under the lock: the task, and a 403 unless the caller is its creator or an assignee. */
  async function lockedInvolvedTask(tx: Tx, projectId: string, taskId: string, userId: string) {
    await lockedMember(tx, projectId, userId);
    const task = await lockedTask(tx, projectId, taskId);
    if (!(await isInvolved(tx, task, userId))) {
      throw forbidden("Only people involved in the task can do this.");
    }
    return task;
  }

  /** Runs `createOnce`; when an identical create won at the same moment, runs it once more. */
  async function withRetry<T>(createOnce: () => Promise<T>): Promise<T> {
    try {
      return await createOnce();
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      return createOnce();
    }
  }

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { taskId } = await requireTask(req, userId);
      const rows = await prisma.taskPhoto.findMany({
        where: { taskId },
        include,
        orderBy: order,
      });
      res.json({ photos: rows.map((p) => photoResponse(store, p)) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/sign", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { projectId, taskId } = await requireTask(req, userId);
      const body = signSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedInvolvedTask(tx, projectId, taskId, userId);
        const existing = await tx.taskPhoto.findUnique({
          where: { id: body.id },
          select: { taskId: true },
        });
        if (existing) {
          if (existing.taskId !== taskId) {
            throw new AppError(409, "id_conflict", "That photo id is already taken.");
          }
          return; // a retry for a photo already recorded: no new place is used
        }
        if ((await tx.taskPhoto.count({ where: { taskId } })) >= MAX_PHOTOS_PER_TASK) {
          throw limitReached();
        }
      });

      const publicId = photoPublicId(projectId, taskId, body.id);
      const timestamp = Math.floor(now().getTime() / 1000);
      res.json({
        cloudName: store.cloudName,
        apiKey: store.apiKey,
        timestamp,
        signature: store.sign(publicId, timestamp),
        publicId,
        type: UPLOAD_TYPE,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { projectId, taskId } = await requireTaskOrDestroyUpload(req, userId, store);
      const body = recordSchema.parse(req.body);
      // The phone can only record the exact image that was signed for this task and id.
      if (body.publicId !== photoPublicId(projectId, taskId, body.id)) {
        throw new AppError(400, "validation_failed", "Invalid fields: publicId.");
      }

      // Set when the upload can no longer be recorded, so the image is removed instead of orphaned.
      let orphaned = false;
      let result;
      try {
        result = await withRetry(() =>
          prisma.$transaction(async (tx) => {
            orphaned = false;
            await lockedMember(tx, projectId, userId);
            const task = await lockedTask(tx, projectId, taskId).catch((err: unknown) => {
              // Only when the task was deleted after signing; a database error keeps the upload.
              if (err instanceof AppError && err.status === 404) orphaned = true;
              throw err;
            });
            if (!(await isInvolved(tx, task, userId))) {
              throw forbidden("Only people involved in the task can do this.");
            }
            const existing = await tx.taskPhoto.findUnique({
              where: { id: body.id },
              include,
            });
            if (existing) {
              if (existing.taskId !== taskId) {
                throw new AppError(409, "id_conflict", "That photo id is already taken.");
              }
              return { status: 200, photo: existing };
            }
            // Counted under the project lock, so concurrent records can't pass the limit together.
            if ((await tx.taskPhoto.count({ where: { taskId } })) >= MAX_PHOTOS_PER_TASK) {
              orphaned = true;
              throw limitReached();
            }
            // The caption time starts at the epoch: an edit the phone queued after recording the
            // photo must win even though the record reached us later.
            const photo = await tx.taskPhoto.create({
              data: {
                id: body.id,
                taskId,
                addedById: userId,
                publicId: body.publicId,
                width: body.width,
                height: body.height,
                caption: body.caption ?? "",
                captionEditedAt: new Date(0),
                createdAt: now(),
              },
              include,
            });
            return { status: 201, photo };
          }),
        );
      } catch (err) {
        if (orphaned) void destroyImages(store, [body.publicId]);
        throw err;
      }
      res.status(result.status).json(photoResponse(store, result.photo));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:photoId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { projectId, taskId } = await requireTask(req, userId);
      const photoId = await requirePhoto(req, taskId);
      const fields = patchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedInvolvedTask(tx, projectId, taskId, userId);
        const photo = await tx.taskPhoto.findFirst({
          where: { id: photoId, taskId },
          select: { id: true },
        });
        if (!photo) throw notFound(); // deleted meanwhile
        await applyLastWriteWins(fields, now(), async (where, data) => {
          await tx.taskPhoto.updateMany({
            where: { id: photoId, taskId, ...where },
            data,
          } as Prisma.TaskPhotoUpdateManyArgs);
        });
      });

      // Always answer with the current state, even when the change lost.
      const current = await prisma.taskPhoto.findFirst({
        where: { id: photoId, taskId },
        include,
      });
      if (!current) throw notFound(); // deleted meanwhile
      res.json(photoResponse(store, current));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:photoId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { projectId, taskId } = await requireTask(req, userId);
      const photoId = await requirePhoto(req, taskId);
      const publicId = await prisma.$transaction(async (tx) => {
        await lockedInvolvedTask(tx, projectId, taskId, userId);
        const photo = await tx.taskPhoto.findFirst({
          where: { id: photoId, taskId },
          select: { publicId: true },
        });
        if (!photo) throw notFound();
        const { count } = await tx.taskPhoto.deleteMany({
          where: { id: photoId, taskId },
        });
        if (count === 0) throw notFound();
        return photo.publicId;
      });
      // After the commit: the row is gone either way, and a failed destroy is only logged.
      res.status(204).end();
      void destroyImages(store, [publicId]);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
