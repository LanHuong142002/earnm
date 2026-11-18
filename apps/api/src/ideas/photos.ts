import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { multiLineText } from "../http/text.js";
import { findForMember } from "../projects/access.js";
import { UPLOAD_TYPE, type PhotoStore } from "../photos/cloudinary.js";
import { destroyImages } from "../photos/destroy.js";
import {
  canManage,
  change,
  forbidden,
  idSchema,
  lockedIdea,
  lockedMember,
  notFound,
  param,
  requireIdea,
  withRetry,
  type Tx,
} from "./common.js";

/** An idea holds at most this many photos. */
export const MAX_PHOTOS_PER_IDEA = 10;
/** A caption is at most this many characters after trimming. */
export const MAX_CAPTION_LENGTH = 200;
/** Larger than any phone photo after the 1600 px shrink; only a sanity bound. */
const MAX_DIMENSION = 20000;

const captionSchema = multiLineText(MAX_CAPTION_LENGTH);

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

const patchSchema = z.object({ caption: change(captionSchema) }).strict();

const order = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.IdeaPhotoOrderByWithRelationInput[];
const include = {
  addedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.IdeaPhotoInclude;
type PhotoRow = Prisma.IdeaPhotoGetPayload<{ include: typeof include }>;

/** The exact shape the mobile app expects. The image addresses are signed and only built here. */
function photoResponse(store: PhotoStore, p: PhotoRow) {
  return {
    id: p.id,
    ideaId: p.ideaId,
    addedBy: p.addedBy ? { id: p.addedBy.id, displayName: p.addedBy.displayName } : null,
    caption: p.caption,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt.toISOString(),
    thumbUrl: store.thumbUrl(p.publicId),
    url: store.url(p.publicId),
  };
}

/** Where a photo of this idea lives on Cloudinary: fixed by the server, never chosen by the phone. */
export function ideaPhotoPublicId(projectId: string, ideaId: string, photoId: string): string {
  return `earnm/${projectId}/ideas/${ideaId}/${photoId}`;
}

function limitReached(): AppError {
  return new AppError(409, "photo_limit_reached", `An idea can hold at most ${MAX_PHOTOS_PER_IDEA} photos.`);
}

export function createIdeaPhotosRouter(deps: {
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

  /**
   * `requireIdea` for the record route. When the caller is a member and only the idea is gone, the
   * image they uploaded after signing can never be recorded, so it is removed in the background.
   */
  async function requireIdeaOrDestroyUpload(req: Request, userId: string, store: PhotoStore) {
    try {
      return await requireIdea(prisma, req, userId);
    } catch (err) {
      const projectId = idSchema.safeParse(param(req, "projectId"));
      const ideaId = idSchema.safeParse(param(req, "ideaId"));
      const photoId = idSchema.safeParse((req.body as { id?: unknown } | undefined)?.id);
      if (projectId.success && ideaId.success && photoId.success) {
        const member = await findForMember(prisma, projectId.data, userId);
        const idea = member
          ? await prisma.idea.findFirst({
              where: { id: ideaId.data, projectId: projectId.data },
              select: { id: true },
            })
          : null;
        if (member && !idea) {
          void destroyImages(store, [ideaPhotoPublicId(projectId.data, ideaId.data, photoId.data)]);
        }
      }
      throw err;
    }
  }

  /** The photo on this idea, or a 404 that looks the same whether it's missing or elsewhere. */
  async function requirePhoto(req: Request, ideaId: string) {
    const parsed = idSchema.safeParse(param(req, "photoId"));
    if (!parsed.success) throw notFound();
    const photo = await prisma.ideaPhoto.findFirst({
      where: { id: parsed.data, ideaId },
      select: { id: true },
    });
    if (!photo) throw notFound();
    return photo.id;
  }

  /** Under the lock: the idea, and a 403 unless the caller is its author or an Owner. */
  async function lockedManagedIdea(tx: Tx, projectId: string, ideaId: string, userId: string) {
    const role = await lockedMember(tx, projectId, userId);
    const idea = await lockedIdea(tx, projectId, ideaId);
    if (!canManage(idea, userId, role)) {
      throw forbidden("Only the author or an owner can do this.");
    }
    return idea;
  }

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { ideaId } = await requireIdea(prisma, req, userId);
      const rows = await prisma.ideaPhoto.findMany({ where: { ideaId }, include, orderBy: order });
      res.json({ photos: rows.map((p) => photoResponse(store, p)) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/sign", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const body = signSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedManagedIdea(tx, projectId, ideaId, userId);
        const existing = await tx.ideaPhoto.findUnique({
          where: { id: body.id },
          select: { ideaId: true },
        });
        if (existing) {
          if (existing.ideaId !== ideaId) {
            throw new AppError(409, "id_conflict", "That photo id is already taken.");
          }
          return; // a retry for a photo already recorded: no new place is used
        }
        if ((await tx.ideaPhoto.count({ where: { ideaId } })) >= MAX_PHOTOS_PER_IDEA) {
          throw limitReached();
        }
      });

      const publicId = ideaPhotoPublicId(projectId, ideaId, body.id);
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
      const { projectId, ideaId } = await requireIdeaOrDestroyUpload(req, userId, store);
      const body = recordSchema.parse(req.body);
      // The phone can only record the exact image that was signed for this idea and id.
      if (body.publicId !== ideaPhotoPublicId(projectId, ideaId, body.id)) {
        throw new AppError(400, "validation_failed", "Invalid fields: publicId.");
      }

      // Set when the upload can no longer be recorded, so the image is removed instead of orphaned.
      let orphaned = false;
      let result;
      try {
        result = await withRetry(() =>
          prisma.$transaction(async (tx) => {
            orphaned = false;
            const role = await lockedMember(tx, projectId, userId);
            const idea = await lockedIdea(tx, projectId, ideaId).catch((err: unknown) => {
              // Only when the idea was deleted after signing; a database error keeps the upload.
              if (err instanceof AppError && err.status === 404) orphaned = true;
              throw err;
            });
            if (!canManage(idea, userId, role)) {
              throw forbidden("Only the author or an owner can do this.");
            }
            const existing = await tx.ideaPhoto.findUnique({ where: { id: body.id }, include });
            if (existing) {
              if (existing.ideaId !== ideaId) {
                throw new AppError(409, "id_conflict", "That photo id is already taken.");
              }
              return { status: 200, photo: existing };
            }
            // Counted under the project lock, so concurrent records can't pass the limit together.
            if ((await tx.ideaPhoto.count({ where: { ideaId } })) >= MAX_PHOTOS_PER_IDEA) {
              orphaned = true;
              throw limitReached();
            }
            // The caption time starts at the epoch: an edit the phone queued after recording the
            // photo must win even though the record reached us later.
            const photo = await tx.ideaPhoto.create({
              data: {
                id: body.id,
                ideaId,
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
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const photoId = await requirePhoto(req, ideaId);
      const fields = patchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedManagedIdea(tx, projectId, ideaId, userId);
        const photo = await tx.ideaPhoto.findFirst({
          where: { id: photoId, ideaId },
          select: { id: true },
        });
        if (!photo) throw notFound(); // deleted meanwhile
        await applyLastWriteWins(fields, now(), async (where, data) => {
          await tx.ideaPhoto.updateMany({
            where: { id: photoId, ideaId, ...where },
            data,
          } as Prisma.IdeaPhotoUpdateManyArgs);
        });
      });

      // Always answer with the current state, even when the change lost.
      const current = await prisma.ideaPhoto.findFirst({ where: { id: photoId, ideaId }, include });
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
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const photoId = await requirePhoto(req, ideaId);
      const publicId = await prisma.$transaction(async (tx) => {
        await lockedManagedIdea(tx, projectId, ideaId, userId);
        const photo = await tx.ideaPhoto.findFirst({
          where: { id: photoId, ideaId },
          select: { publicId: true },
        });
        if (!photo) throw notFound();
        const { count } = await tx.ideaPhoto.deleteMany({ where: { id: photoId, ideaId } });
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
