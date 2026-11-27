import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { multiLineText } from "../http/text.js";
import { findForMember } from "../projects/access.js";
import { UPLOAD_TYPE, type PhotoStore } from "../photos/cloudinary.js";
import { destroyImages, destroyImagesWithin } from "../photos/destroy.js";
import { change, forbidden, idSchema, lockedMember, notFound, param, withRetry, type Tx } from "../ideas/common.js";

/** A draft holds at most this many photos. */
export const MAX_PHOTOS_PER_DRAFT = 10;
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

const order = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.DraftPhotoOrderByWithRelationInput[];
const include = {
  addedBy: { select: { id: true, displayName: true } },
} satisfies Prisma.DraftPhotoInclude;
type PhotoRow = Prisma.DraftPhotoGetPayload<{ include: typeof include }>;

/** The exact shape the mobile app expects. The image addresses are signed and only built here. */
function photoResponse(store: PhotoStore, p: PhotoRow) {
  return {
    id: p.id,
    draftId: p.draftId,
    addedBy: p.addedBy ? { id: p.addedBy.id, displayName: p.addedBy.displayName } : null,
    caption: p.caption,
    width: p.width,
    height: p.height,
    createdAt: p.createdAt.toISOString(),
    thumbUrl: store.thumbUrl(p.publicId),
    url: store.url(p.publicId),
  };
}

/** Where a photo of this draft lives on Cloudinary: fixed by the server, never chosen by the phone. */
export function draftPhotoPublicId(projectId: string, draftId: string, photoId: string): string {
  return `earnm/${projectId}/drafts/${draftId}/${photoId}`;
}

function limitReached(): AppError {
  return new AppError(409, "photo_limit_reached", `A draft can hold at most ${MAX_PHOTOS_PER_DRAFT} photos.`);
}

function converted(): AppError {
  return new AppError(409, "draft_converted", "This draft was already turned into a product.");
}

export function createDraftPhotosRouter(deps: {
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

  /** The caller's membership in `:projectId` and the draft in it; every miss is the same 404. */
  async function requireDraft(req: Request, userId: string) {
    const projectId = idSchema.safeParse(param(req, "projectId"));
    const draftId = idSchema.safeParse(param(req, "draftId"));
    if (!projectId.success || !draftId.success) throw notFound();
    const member = await findForMember(prisma, projectId.data, userId);
    if (!member) throw notFound();
    const draft = await prisma.draft.findFirst({
      where: { id: draftId.data, projectId: projectId.data },
      select: { id: true },
    });
    if (!draft) throw notFound();
    return { projectId: projectId.data, draftId: draft.id };
  }

  /**
   * `requireDraft` for the record route. When the caller is a member and only the draft is gone, the
   * image they uploaded after signing can never be recorded, so it is removed in the background.
   *
   * Only a current project member can trigger this (a non-member's upload is left alone), and the
   * public id is always built from this project's and this draft's ids. A draft that no longer
   * exists has no photo rows left (they go with it by cascade), so no recorded photo can own it.
   */
  async function requireDraftOrDestroyUpload(req: Request, userId: string, store: PhotoStore) {
    try {
      return await requireDraft(req, userId);
    } catch (err) {
      const projectId = idSchema.safeParse(param(req, "projectId"));
      const draftId = idSchema.safeParse(param(req, "draftId"));
      const photoId = idSchema.safeParse((req.body as { id?: unknown } | undefined)?.id);
      if (projectId.success && draftId.success && photoId.success) {
        const member = await findForMember(prisma, projectId.data, userId);
        const draft = member
          ? await prisma.draft.findFirst({
              where: { id: draftId.data, projectId: projectId.data },
              select: { id: true },
            })
          : null;
        if (member && !draft) {
          void destroyImages(store, [draftPhotoPublicId(projectId.data, draftId.data, photoId.data)]);
        }
      }
      throw err;
    }
  }

  /** The photo on this draft, or a 404 that looks the same whether it's missing or elsewhere. */
  async function requirePhoto(req: Request, draftId: string) {
    const parsed = idSchema.safeParse(param(req, "photoId"));
    if (!parsed.success) throw notFound();
    const photo = await prisma.draftPhoto.findFirst({
      where: { id: parsed.data, draftId },
      select: { id: true },
    });
    if (!photo) throw notFound();
    return photo.id;
  }

  /** Under the lock: the caller's role and the draft, a 409 when it was converted. */
  async function lockedOpenDraft(tx: Tx, projectId: string, draftId: string, userId: string) {
    const role = await lockedMember(tx, projectId, userId);
    const draft = await tx.draft.findFirst({ where: { id: draftId, projectId }, select: { id: true, convertedAt: true } });
    if (!draft) throw notFound();
    if (draft.convertedAt !== null) throw converted();
    return role;
  }

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { draftId } = await requireDraft(req, userId);
      const rows = await prisma.draftPhoto.findMany({ where: { draftId }, include, orderBy: order });
      res.json({ photos: rows.map((p) => photoResponse(store, p)) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/sign", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { projectId, draftId } = await requireDraft(req, userId);
      const body = signSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedOpenDraft(tx, projectId, draftId, userId);
        const existing = await tx.draftPhoto.findUnique({
          where: { id: body.id },
          select: { draftId: true },
        });
        if (existing) {
          if (existing.draftId !== draftId) {
            throw new AppError(409, "id_conflict", "That photo id is already taken.");
          }
          return; // a retry for a photo already recorded: no new place is used
        }
        if ((await tx.draftPhoto.count({ where: { draftId } })) >= MAX_PHOTOS_PER_DRAFT) {
          throw limitReached();
        }
      });

      const publicId = draftPhotoPublicId(projectId, draftId, body.id);
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
      const { projectId, draftId } = await requireDraftOrDestroyUpload(req, userId, store);
      const body = recordSchema.parse(req.body);
      // The phone can only record the exact image that was signed for this draft and id.
      if (body.publicId !== draftPhotoPublicId(projectId, draftId, body.id)) {
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
            const draft = await tx.draft.findFirst({ where: { id: draftId, projectId }, select: { id: true, convertedAt: true } });
            if (!draft) {
              orphaned = true; // deleted after signing; its photo rows went with it
              throw notFound();
            }
            if (draft.convertedAt !== null) {
              // Never destroy an image a recorded photo already owns: the public id is computable
              // by any member, and a retry of a recorded photo must not lose its image.
              orphaned = !(await tx.draftPhoto.findFirst({ where: { publicId: body.publicId }, select: { id: true } }));
              throw converted();
            }
            const existing = await tx.draftPhoto.findUnique({ where: { id: body.id }, include });
            if (existing) {
              if (existing.draftId !== draftId) {
                // That id belongs to another draft's photo, whose image has a different public id.
                orphaned = !(await tx.draftPhoto.findFirst({ where: { publicId: body.publicId }, select: { id: true } }));
                throw new AppError(409, "id_conflict", "That photo id is already taken.");
              }
              return { status: 200, photo: existing };
            }
            // Counted under the project lock, so concurrent records can't pass the limit together.
            if ((await tx.draftPhoto.count({ where: { draftId } })) >= MAX_PHOTOS_PER_DRAFT) {
              orphaned = true;
              throw limitReached();
            }
            // The caption time starts at the epoch: an edit the phone queued after recording the
            // photo must win even though the record reached us later.
            const photo = await tx.draftPhoto.create({
              data: {
                id: body.id,
                draftId,
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

  /** Under the lock: the photo's adder or an Owner may change it; anyone else gets a 403. */
  async function lockedManagedPhoto(tx: Tx, projectId: string, draftId: string, photoId: string, userId: string) {
    const role = await lockedOpenDraft(tx, projectId, draftId, userId);
    const photo = await tx.draftPhoto.findFirst({
      where: { id: photoId, draftId },
      select: { id: true, publicId: true, addedById: true },
    });
    if (!photo) throw notFound(); // deleted meanwhile
    if (role !== "owner" && photo.addedById !== userId) {
      throw forbidden("Only the person who added the photo or an owner can do this.");
    }
    return photo;
  }

  router.patch("/:photoId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const store = requireStore();
      const { projectId, draftId } = await requireDraft(req, userId);
      const photoId = await requirePhoto(req, draftId);
      const fields = patchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedManagedPhoto(tx, projectId, draftId, photoId, userId);
        await applyLastWriteWins(fields, now(), async (where, data) => {
          await tx.draftPhoto.updateMany({
            where: { id: photoId, draftId, ...where },
            data,
          } as Prisma.DraftPhotoUpdateManyArgs);
        });
      });

      // Always answer with the current state, even when the change lost.
      const current = await prisma.draftPhoto.findFirst({ where: { id: photoId, draftId }, include });
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
      const { projectId, draftId } = await requireDraft(req, userId);
      const photoId = await requirePhoto(req, draftId);
      const publicId = await prisma.$transaction(async (tx) => {
        const photo = await lockedManagedPhoto(tx, projectId, draftId, photoId, userId);
        const { count } = await tx.draftPhoto.deleteMany({ where: { id: photoId, draftId } });
        if (count === 0) throw notFound();
        return photo.publicId;
      });
      // After the commit, awaited before the answer so a crash can't silently orphan the image;
      // a failed destroy is only logged (destroyImages never throws).
      await destroyImagesWithin(store, [publicId]);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
