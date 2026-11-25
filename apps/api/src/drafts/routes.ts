import { Router } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { multiLineText, NAME_MAX, singleLineText } from "../http/text.js";
import { change, idSchema, lockedMember, notFound, param, withRetry } from "../ideas/common.js";
import type { Tx } from "../ideas/common.js";
import { MAX_PRICE, MAX_QUANTITY } from "../ingredients/routes.js";
import { nameKey } from "../labels/nameKey.js";
import { findForMember } from "../projects/access.js";
import { amountSchema } from "../products/routes.js";
import { SIZE_ORDER } from "../products/response.js";
import { draftInclude, draftMissing, draftResponse } from "./response.js";

/** A project holds at most this many unconverted drafts. */
export const MAX_DRAFTS_PER_PROJECT = 200;
/** A draft holds at most this many recipe lines. */
export const MAX_LINES_PER_DRAFT = 100;
const MAX_NOTE_LENGTH = 2000;

const nameSchema = singleLineText(NAME_MAX);
const noteSchema = multiLineText(MAX_NOTE_LENGTH);
const sizesSchema = z
  .array(z.enum(SIZE_ORDER))
  .min(1)
  .max(3)
  .refine((a) => new Set(a).size === a.length, "Sizes must not repeat.");
// The upper bound depends on the project's currency and is checked in the route.
const priceSchema = z.number().int().min(0).max(MAX_PRICE.VND);
const lineAmountSchema = amountSchema.refine((a) => a > 0, "Must be above 0.");
const modeSchema = z.enum(["weight", "volume", "portion"]);
// Purchase quantity is in base units (g, ml, portion) with at most 3 decimals.
const quantitySchema = z
  .number()
  .gt(0)
  .max(MAX_QUANTITY)
  .refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, "At most 3 decimals.");

const createSchema = z
  .object({
    id: z.uuid(),
    name: nameSchema,
    sizes: sizesSchema,
    expectedPrice: priceSchema.nullable().optional(),
    note: noteSchema.optional(),
  })
  .strict();

const patchSchema = z
  .object({
    name: change(nameSchema).optional(),
    sizes: change(sizesSchema).optional(),
    expectedPrice: change(priceSchema.nullable()).optional(),
    note: change(noteSchema).optional(),
    status: change(z.enum(["working", "done"])).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

const lineCreateSchema = z.discriminatedUnion("kind", [
  z.object({ id: z.uuid(), kind: z.literal("existing"), ingredientId: z.uuid(), amount: lineAmountSchema }).strict(),
  z
    .object({
      id: z.uuid(),
      kind: z.literal("new"),
      newName: nameSchema,
      newKind: modeSchema,
      purchaseQty: quantitySchema.nullable().optional(),
      purchasePrice: priceSchema.nullable().optional(),
      amount: lineAmountSchema,
    })
    .strict(),
]);

const linePatchSchema = z
  .object({
    amount: change(lineAmountSchema).optional(),
    newName: change(nameSchema).optional(),
    newKind: change(modeSchema).optional(),
    purchaseQty: change(quantitySchema.nullable()).optional(),
    purchasePrice: change(priceSchema.nullable()).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

const invalid = (field: string) => new AppError(400, "validation_failed", `Invalid fields: ${field}.`);
const converted = () => new AppError(409, "draft_converted", "This draft was already turned into a product.");
const ingredientNameTaken = () =>
  new AppError(409, "ingredient_name_taken", "An ingredient in this project already has that name.");
const lineNameTaken = () =>
  new AppError(409, "draft_line_name_taken", "Another new ingredient in this draft has that name.");

/**
 * Drink drafts: a drink worked out before it exists, with a recipe of existing and new ingredients.
 * Every edit runs under the project lock; a converted draft is read-only.
 */
export function createDraftsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  async function requireMember(rawProjectId: string | undefined, userId: string) {
    const parsed = idSchema.safeParse(rawProjectId);
    if (!parsed.success) throw notFound();
    const found = await findForMember(prisma, parsed.data, userId);
    if (!found) throw notFound();
    return parsed.data;
  }

  async function requireDraft(req: Parameters<typeof param>[0], userId: string) {
    const projectId = await requireMember(param(req, "projectId"), userId);
    const draftId = idSchema.safeParse(param(req, "draftId"));
    if (!draftId.success) throw notFound();
    const found = await prisma.draft.findFirst({ where: { id: draftId.data, projectId }, select: { id: true } });
    if (!found) throw notFound();
    return { projectId, draftId: found.id };
  }

  async function requireLine(req: Parameters<typeof param>[0], userId: string) {
    const { projectId, draftId } = await requireDraft(req, userId);
    const lineId = idSchema.safeParse(param(req, "lineId"));
    if (!lineId.success) throw notFound();
    const found = await prisma.draftLine.findFirst({ where: { id: lineId.data, draftId }, select: { id: true } });
    if (!found) throw notFound();
    return { projectId, draftId, lineId: found.id };
  }

  /** The draft under the project lock: 404 if gone, 409 if it was converted. */
  async function lockedOpenDraft(tx: Tx, projectId: string, draftId: string) {
    const draft = await tx.draft.findFirst({ where: { id: draftId, projectId } });
    if (!draft) throw notFound(); // deleted meanwhile
    if (draft.convertedAt !== null) throw converted();
    return draft;
  }

  /** A done draft that an edit left incomplete goes back to working, stamped with the edit's time. */
  async function reopenIfIncomplete(tx: Tx, draftId: string) {
    const row = await load(tx, draftId);
    if (!row || row.status !== "done" || draftMissing(row).length === 0) return;
    await tx.draft.updateMany({ where: { id: draftId, status: "done" }, data: { status: "working", statusEditedAt: now() } });
  }

  async function assertPriceInRange(tx: Tx, projectId: string, price: number | null | undefined, field: string) {
    if (price === null || price === undefined) return;
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { currency: true } });
    if (!project) throw notFound();
    if (price > MAX_PRICE[project.currency]) throw invalid(field);
  }

  const load = (db: Tx | PrismaClient, draftId: string) =>
    db.draft.findUnique({ where: { id: draftId }, include: draftInclude });

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireMember(param(req, "projectId"), userId);
      const rows = await prisma.draft.findMany({
        where: { projectId },
        include: draftInclude,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      res.json({ drafts: rows.map(draftResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireMember(param(req, "projectId"), userId);
      const body = createSchema.parse(req.body);

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          const existing = await load(tx, body.id);
          if (existing) {
            if (existing.projectId !== projectId) throw new AppError(409, "id_conflict", "That draft id is already taken.");
            // A retry of a create the phone already sent (offline queue).
            return { status: 200, row: existing };
          }
          // Counted under the project lock, so concurrent creates can't pass the limit together.
          if ((await tx.draft.count({ where: { projectId, convertedAt: null } })) >= MAX_DRAFTS_PER_PROJECT) {
            throw new AppError(409, "draft_limit_reached", `A project can hold at most ${MAX_DRAFTS_PER_PROJECT} drafts.`);
          }
          await assertPriceInRange(tx, projectId, body.expectedPrice, "expectedPrice");
          const epoch = new Date(0);
          await tx.draft.create({
            data: {
              id: body.id,
              projectId,
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
          return { status: 201, row: await load(tx, body.id) };
        }),
      );
      if (!result.row) throw notFound();
      res.status(result.status).json(draftResponse(result.row));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:draftId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, draftId } = await requireDraft(req, userId);
      const body = patchSchema.parse(req.body);
      // Status goes last so a Done check sees the other fields of the same request.
      const { status, ...rest } = body;
      const fields = { ...rest, status };

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        await lockedOpenDraft(tx, projectId, draftId);
        // A price over the maximum is wrong on its own, however recent; the rest resolves per field.
        if (fields.expectedPrice) await assertPriceInRange(tx, projectId, fields.expectedPrice.value, "expectedPrice");
        await applyLastWriteWins(fields, now(), async (where, data) => {
          const claimed = await tx.draft.updateMany({
            where: { id: draftId, projectId, ...where },
            data: data as Prisma.DraftUpdateManyMutationInput,
          });
          // Only a status change that wins is checked, so a stale "done" never blocks other fields.
          if (claimed.count === 1 && data["status"] === "done") {
            const row = await load(tx, draftId);
            const missing = row ? draftMissing(row) : [];
            if (missing.length > 0) {
              throw new AppError(409, "draft_incomplete", "The draft is missing what it needs to be done.", { missing });
            }
          }
        });
        await reopenIfIncomplete(tx, draftId);
      });

      const row = await load(prisma, draftId);
      if (!row) throw notFound(); // deleted meanwhile
      res.json(draftResponse(row));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:draftId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, draftId } = await requireDraft(req, userId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        // A converted draft can be deleted too: the product it made stays.
        await tx.draft.deleteMany({ where: { id: draftId, projectId } });
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post("/:draftId/lines", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, draftId } = await requireDraft(req, userId);
      const body = lineCreateSchema.parse(req.body);

      const status = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          const existing = await tx.draftLine.findUnique({ where: { id: body.id } });
          if (existing) {
            if (existing.draftId !== draftId) throw new AppError(409, "id_conflict", "That line id is already taken.");
            // A retry of a create the phone already sent (offline queue).
            return 200;
          }
          await lockedOpenDraft(tx, projectId, draftId);
          const lines = await tx.draftLine.findMany({
            where: { draftId },
            select: { ingredientId: true, newNameKey: true, position: true },
          });
          if (lines.length >= MAX_LINES_PER_DRAFT) {
            throw new AppError(409, "draft_line_limit_reached", `A draft can hold at most ${MAX_LINES_PER_DRAFT} lines.`);
          }
          const position = lines.reduce((max, l) => Math.max(max, l.position), 0) + 1;
          const epoch = new Date(0);
          const times = {
            newNameEditedAt: epoch,
            newKindEditedAt: epoch,
            purchaseQtyEditedAt: epoch,
            purchasePriceEditedAt: epoch,
            amountEditedAt: epoch,
          };
          if (body.kind === "existing") {
            const ingredient = await tx.ingredient.findFirst({
              where: { id: body.ingredientId, projectId },
              select: { id: true },
            });
            if (!ingredient) throw invalid("ingredientId");
            if (lines.some((l) => l.ingredientId === body.ingredientId)) {
              throw new AppError(409, "draft_line_duplicate", "That ingredient is already in this draft.");
            }
            await tx.draftLine.create({
              data: { id: body.id, draftId, kind: "existing", ingredientId: body.ingredientId, amount: body.amount, position, createdAt: now(), ...times },
            });
            return 201;
          }
          await assertPriceInRange(tx, projectId, body.purchasePrice, "purchasePrice");
          const key = nameKey(body.newName);
          if (lines.some((l) => l.newNameKey === key)) throw lineNameTaken();
          if (await tx.ingredient.findUnique({ where: { projectId_nameKey: { projectId, nameKey: key } }, select: { id: true } })) {
            throw ingredientNameTaken();
          }
          await tx.draftLine.create({
            data: {
              id: body.id,
              draftId,
              kind: "new",
              newName: body.newName,
              newNameKey: key,
              newKind: body.newKind,
              purchaseQty: body.purchaseQty ?? null,
              purchasePrice: body.purchasePrice ?? null,
              amount: body.amount,
              position,
              createdAt: now(),
              ...times,
            },
          });
          await reopenIfIncomplete(tx, draftId);
          return 201;
        }),
      );
      const row = await load(prisma, draftId);
      if (!row) throw notFound();
      res.status(status).json(draftResponse(row));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:draftId/lines/:lineId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, draftId, lineId } = await requireLine(req, userId);
      const body = linePatchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        await lockedOpenDraft(tx, projectId, draftId);
        const line = await tx.draftLine.findFirst({ where: { id: lineId, draftId } });
        if (!line) throw notFound(); // deleted meanwhile
        // Fields of a new ingredient mean nothing on an existing one: wrong on their own terms.
        if (line.kind === "existing" && Object.keys(body).some((k) => k !== "amount")) {
          throw invalid(Object.keys(body).filter((k) => k !== "amount").join(", "));
        }
        if (body.purchasePrice) await assertPriceInRange(tx, projectId, body.purchasePrice.value, "purchasePrice");
        await applyLastWriteWins(body, now(), async (where, data) => {
          const scope = { id: lineId, draftId, ...where };
          if (!("newName" in data)) {
            await tx.draftLine.updateMany({ where: scope, data: data as Prisma.DraftLineUpdateManyMutationInput });
            return;
          }
          // The name is checked only when this change wins, so a stale one can't refuse the others.
          const value = data["newName"] as string;
          const key = nameKey(value);
          let claimed;
          try {
            claimed = await tx.draftLine.updateMany({
              where: scope,
              data: { newName: value, newNameKey: key, newNameEditedAt: data["newNameEditedAt"] as Date },
            });
          } catch (err) {
            if (isUniqueViolation(err)) throw lineNameTaken();
            throw err;
          }
          if (claimed.count === 1 && (await tx.ingredient.findUnique({ where: { projectId_nameKey: { projectId, nameKey: key } }, select: { id: true } }))) {
            throw ingredientNameTaken();
          }
        });
        await reopenIfIncomplete(tx, draftId);
      });

      const row = await load(prisma, draftId);
      if (!row) throw notFound(); // deleted meanwhile
      res.json(draftResponse(row));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:draftId/lines/:lineId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, draftId, lineId } = await requireLine(req, userId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        await lockedOpenDraft(tx, projectId, draftId);
        const { count } = await tx.draftLine.deleteMany({ where: { id: lineId, draftId } });
        if (count === 0) throw notFound();
        await reopenIfIncomplete(tx, draftId);
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
