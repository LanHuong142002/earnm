import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { draftInclude, draftResponse } from "../drafts/response.js";
import { draftPhotoPublicId } from "../drafts/photos.js";
import {
  MAX_DRAFTS_PER_PROJECT,
  assertPriceInRange,
  nameSchema,
  noteSchema,
  priceSchema,
  sizesSchema,
} from "../drafts/routes.js";
import { AppError } from "../http/errors.js";
import type { PhotoStore } from "../photos/cloudinary.js";
import { destroyImages, destroyImagesWithin } from "../photos/destroy.js";
import { lockedMember, notFound, requireIdea, withRetry } from "./common.js";
import { ideaInclude, ideaResponse } from "./response.js";

/** How long one image copy may take before it counts as failed (tests shorten it). */
export const copyWait = { ms: 10_000 };
/** At most this many copies run at once, so an idea with many photos can't flood the store. */
const COPY_CONCURRENCY = 3;

const bodySchema = z
  .object({
    draftId: z.uuid(),
    name: nameSchema,
    sizes: sizesSchema,
    expectedPrice: priceSchema.nullable().optional(),
    note: noteSchema.optional(),
  })
  .strict();

/** One copy, never rejecting: `null` when the store failed or took longer than `copyWait.ms`. */
async function copyOne(
  store: PhotoStore,
  source: string,
  target: string,
): Promise<{ width: number; height: number } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = new Promise<{ width: number; height: number }>((resolve) => resolve(store.copy(source, target)));
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), copyWait.ms);
    timer.unref?.();
  });
  try {
    const result = await Promise.race([attempt, timeout]);
    if (result === "timeout") {
      // The copy may still land. This request made that id and no row will own it: remove it then.
      attempt.then(
        () => destroyImages(store, [target]),
        () => {},
      );
      return null;
    }
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** `POST /projects/:projectId/ideas/:ideaId/draft`: starts a drink draft from an accepted idea, once. */
export function createIdeaToDraftRouter(deps: {
  prisma: PrismaClient;
  now: () => Date;
  photoStore?: PhotoStore | null;
}): Router {
  const { prisma, now } = deps;
  const store = deps.photoStore ?? null;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ideaId } = await requireIdea(prisma, req, userId);
      const body = bodySchema.parse(req.body);
      const { draftId } = body;

      // Step 1: the checks and the draft are one transaction under the project lock, so two requests at
      // once can't both make a draft and the draft limit can't be passed.
      const photos = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          const idea = await tx.idea.findFirst({
            where: { id: ideaId, projectId },
            select: {
              status: true,
              draft: { select: { id: true } },
              photos: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { publicId: true, caption: true } },
            },
          });
          if (!idea) throw notFound(); // deleted meanwhile
          if (idea.status !== "accepted") {
            throw new AppError(409, "idea_not_accepted", "Only an accepted idea can become a draft.");
          }
          if (idea.draft) throw new AppError(409, "idea_already_has_draft", "This idea already has a draft.");
          if (await tx.draft.findUnique({ where: { id: draftId }, select: { id: true } })) {
            throw new AppError(409, "id_conflict", "That draft id is already taken.");
          }
          if ((await tx.draft.count({ where: { projectId, convertedAt: null } })) >= MAX_DRAFTS_PER_PROJECT) {
            throw new AppError(
              409,
              "draft_limit_reached",
              `A project can hold at most ${MAX_DRAFTS_PER_PROJECT} drafts.`,
            );
          }
          await assertPriceInRange(tx, projectId, body.expectedPrice, "expectedPrice");
          const epoch = new Date(0);
          await tx.draft.create({
            data: {
              id: draftId,
              projectId,
              ideaId,
              name: body.name,
              sizes: body.sizes,
              expectedPrice: body.expectedPrice ?? null,
              note: body.note ?? "",
              nameEditedAt: epoch,
              sizesEditedAt: epoch,
              expectedPriceEditedAt: epoch,
              noteEditedAt: epoch,
              statusEditedAt: epoch,
              createdAt: now(),
            },
          });
          return idea.photos;
        }),
      );

      // Step 2: copy the photos, outside any transaction (a copy is a network call).
      type Copied = { publicId: string; caption: string; width: number; height: number };
      const copied: Copied[] = [];
      if (store && photos.length > 0) {
        const queue = photos.map((p) => ({ ...p, target: draftPhotoPublicId(projectId, draftId, randomUUID()) }));
        const results: (Copied | null)[] = queue.map(() => null);
        let next = 0;
        const worker = async () => {
          while (next < queue.length) {
            const index = next++;
            const item = queue[index]!;
            const size = await copyOne(store, item.publicId, item.target);
            if (size) results[index] = { publicId: item.target, caption: item.caption, ...size };
          }
        };
        await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, queue.length) }, worker));
        for (const r of results) if (r) copied.push(r);
      }

      // Step 3: record the copies. If that fails, or the draft is gone, the copies are removed: only the
      // ids made above, and none that a recorded row owns.
      let recorded = 0;
      if (copied.length > 0) {
        let draftGone = false;
        try {
          await prisma.$transaction(async (tx) => {
            if (!(await tx.draft.findUnique({ where: { id: draftId }, select: { id: true } }))) {
              draftGone = true;
              throw notFound();
            }
            const at = now().getTime();
            await tx.draftPhoto.createMany({
              data: copied.map((c, index) => ({
                id: randomUUID(),
                draftId,
                addedById: userId,
                publicId: c.publicId,
                width: c.width,
                height: c.height,
                caption: c.caption,
                captionEditedAt: new Date(at),
                createdAt: new Date(at + index),
              })),
            });
          });
          recorded = copied.length;
        } catch (err) {
          let owned = new Set<string>();
          try {
            const rows = await prisma.draftPhoto.findMany({
              where: { publicId: { in: copied.map((c) => c.publicId) } },
              select: { publicId: true },
            });
            owned = new Set(rows.map((r) => r.publicId));
          } catch {
            // Unsure what is recorded: leave the images rather than remove one a row may own.
            owned = new Set(copied.map((c) => c.publicId));
          }
          await destroyImagesWithin(
            store,
            copied.map((c) => c.publicId).filter((id) => !owned.has(id)),
          );
          if (draftGone) throw notFound();
          console.error(
            `Could not record the copied photos for draft ${draftId}: ${err instanceof Error ? err.name : "unknown error"}`,
          );
        }
      }

      const [draft, idea] = await Promise.all([
        prisma.draft.findUnique({ where: { id: draftId }, include: draftInclude }),
        prisma.idea.findUnique({ where: { id: ideaId }, include: ideaInclude }),
      ]);
      if (!draft || !idea) throw notFound();
      res.status(201).json({
        draft: draftResponse(draft),
        idea: ideaResponse(idea, userId),
        photosNotCopied: photos.length - recorded,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
