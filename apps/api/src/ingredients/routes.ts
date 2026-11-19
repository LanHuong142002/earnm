import { Router } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { singleLineText } from "../http/text.js";
import { nameKey } from "../labels/nameKey.js";
import { findForMember } from "../projects/access.js";
import { change, idSchema, lockedMember, notFound, param, withRetry } from "../ideas/common.js";
import type { Tx } from "../ideas/common.js";
import { ingredientInclude, ingredientResponse, PRICE_HISTORY_SIZE } from "./response.js";

/** A project holds at most this many ingredients. */
export const MAX_INGREDIENTS_PER_PROJECT = 300;

/** Largest price in the currency's smallest unit: 1.000.000.000 ₫, or 100.000 $ in cents. */
export const MAX_PRICE: Record<"VND" | "USD", number> = { VND: 1_000_000_000, USD: 10_000_000 };
/** Largest quantity, in base units (g, ml, portion). */
export const MAX_QUANTITY = 1_000_000;

const MODES = ["weight", "volume", "portion"] as const;
type Mode = (typeof MODES)[number];
const UNITS_OF_MODE: Record<Mode, readonly string[]> = {
  weight: ["kg", "g"],
  volume: ["l", "ml"],
  portion: ["portion"],
};

const nameSchema = singleLineText(60);
const modeSchema = z.enum(MODES);

// Quantity is in base units with at most 3 decimals.
const quantitySchema = z
  .number()
  .gt(0)
  .max(MAX_QUANTITY)
  .refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, "At most 3 decimals.");

const purchaseSchema = z
  .object({
    quantity: quantitySchema,
    unit: z.enum(["kg", "g", "l", "ml", "portion"]),
    // The upper bound depends on the project's currency and is checked in the route.
    price: z.number().int().min(0).max(MAX_PRICE.VND),
  })
  .strict();
type Purchase = z.infer<typeof purchaseSchema>;

const unitFits = (mode: Mode, unit: string) => UNITS_OF_MODE[mode].includes(unit);

const createSchema = z
  .object({
    id: z.uuid(),
    name: nameSchema,
    mode: modeSchema,
    isDefault: z.boolean().default(false),
    purchase: purchaseSchema,
  })
  .strict()
  .refine((b) => unitFits(b.mode, b.purchase.unit), {
    message: "The unit does not fit the mode.",
    path: ["purchase"],
  });

const patchSchema = z
  .object({
    name: change(nameSchema).optional(),
    mode: change(modeSchema).optional(),
    purchase: change(purchaseSchema).optional(),
    isDefault: change(z.boolean()).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.")
  .refine((b) => !b.mode || !b.purchase || unitFits(b.mode.value, b.purchase.value.unit), {
    message: "The unit does not fit the mode.",
    path: ["purchase"],
  });

const nameTaken = () =>
  new AppError(409, "ingredient_name_taken", "An ingredient in this project already has that name.");

const invalid = (field: string) => new AppError(400, "validation_failed", `Invalid fields: ${field}.`);

export function createIngredientsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  /** The caller's membership in `:projectId`. A bad id, a missing project and a non-member all give one 404. */
  async function requireMember(rawProjectId: string | undefined, userId: string) {
    const parsed = idSchema.safeParse(rawProjectId);
    if (!parsed.success) throw notFound();
    const found = await findForMember(prisma, parsed.data, userId);
    if (!found) throw notFound();
    return parsed.data;
  }

  async function requireIngredient(req: Parameters<typeof param>[0], userId: string) {
    const projectId = await requireMember(param(req, "projectId"), userId);
    const ingredientId = idSchema.safeParse(param(req, "ingredientId"));
    if (!ingredientId.success) throw notFound();
    const found = await prisma.ingredient.findFirst({
      where: { id: ingredientId.data, projectId },
      select: { id: true },
    });
    if (!found) throw notFound();
    return { projectId, ingredientId: found.id };
  }

  /** Throws 400 when the price is above the maximum for the project's currency. Run inside the write's transaction. */
  async function assertPriceInRange(tx: Tx, projectId: string, price: number): Promise<void> {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { currency: true } });
    if (!project) throw notFound();
    if (price > MAX_PRICE[project.currency]) throw invalid("purchase");
  }

  /** Records a purchase in the history and keeps only the latest few. */
  async function recordPurchase(tx: Tx, ingredientId: string, userId: string, p: Purchase) {
    await tx.ingredientPrice.create({
      data: {
        ingredientId,
        quantity: p.quantity,
        unit: p.unit,
        price: p.price,
        authorId: userId,
        recordedAt: now(),
      },
    });
    const keep = await tx.ingredientPrice.findMany({
      where: { ingredientId },
      orderBy: { id: "desc" },
      take: PRICE_HISTORY_SIZE,
      select: { id: true },
    });
    await tx.ingredientPrice.deleteMany({
      where: { ingredientId, id: { notIn: keep.map((k) => k.id) } },
    });
  }

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireMember(param(req, "projectId"), userId);
      const rows = await prisma.ingredient.findMany({
        where: { projectId },
        include: ingredientInclude,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      });
      res.json({ ingredients: rows.map(ingredientResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:ingredientId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ingredientId } = await requireIngredient(req, userId);
      const row = await prisma.ingredient.findFirst({
        where: { id: ingredientId, projectId },
        include: ingredientInclude,
      });
      if (!row) throw notFound();
      res.json(ingredientResponse(row));
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
          const existing = await tx.ingredient.findUnique({
            where: { id: body.id },
            include: ingredientInclude,
          });
          if (existing) {
            if (existing.projectId !== projectId) {
              throw new AppError(409, "id_conflict", "That ingredient id is already taken.");
            }
            // A retry of a create the phone already sent (offline queue): answer with what was saved,
            // and ignore a body that differs, since the ingredient may have been edited since.
            return { status: 200, row: existing };
          }
          // Counted under the project lock, so concurrent creates can't pass the limit together.
          if ((await tx.ingredient.count({ where: { projectId } })) >= MAX_INGREDIENTS_PER_PROJECT) {
            throw new AppError(
              409,
              "ingredient_limit_reached",
              `A project can hold at most ${MAX_INGREDIENTS_PER_PROJECT} ingredients.`,
            );
          }
          const key = nameKey(body.name);
          if (await tx.ingredient.findUnique({ where: { projectId_nameKey: { projectId, nameKey: key } } })) {
            throw nameTaken();
          }
          await assertPriceInRange(tx, projectId, body.purchase.price);
          // Field times start at the epoch so a queued edit made after the create always wins.
          const epoch = new Date(0);
          try {
            await tx.ingredient.create({
              data: {
                id: body.id,
                projectId,
                name: body.name,
                nameKey: key,
                mode: body.mode,
                quantity: body.purchase.quantity,
                unit: body.purchase.unit,
                price: body.purchase.price,
                isDefault: body.isDefault,
                nameEditedAt: epoch,
                modeEditedAt: epoch,
                purchaseEditedAt: epoch,
                defaultEditedAt: epoch,
                createdAt: now(),
              },
            });
          } catch (err) {
            if (isUniqueViolation(err)) throw nameTaken();
            throw err;
          }
          await recordPurchase(tx, body.id, userId, body.purchase);
          const row = await tx.ingredient.findUniqueOrThrow({
            where: { id: body.id },
            include: ingredientInclude,
          });
          return { status: 201, row };
        }),
      );
      res.status(result.status).json(ingredientResponse(result.row));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:ingredientId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ingredientId } = await requireIngredient(req, userId);
      const body = patchSchema.parse(req.body);
      // The stored column for the flag is `default`'s time, so the field travels as `default`.
      const { isDefault, ...rest } = body;
      const fields = { ...rest, default: isDefault };

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const current = await tx.ingredient.findFirst({ where: { id: ingredientId, projectId } });
        if (!current) throw notFound(); // deleted meanwhile
        if (fields.purchase) {
          await assertPriceInRange(tx, projectId, fields.purchase.value.price);
          if (!fields.mode && !unitFits(current.mode, fields.purchase.value.unit)) throw invalid("purchase");
        }
        if (fields.mode && !fields.purchase && !unitFits(fields.mode.value, current.unit)) {
          throw invalid("mode");
        }

        // Column names come from the field names, so TypeScript can't check them; the route tests do.
        await applyLastWriteWins(fields, now(), async (where, data) => {
          const scope = { id: ingredientId, projectId, ...where };
          if ("name" in data) {
            const key = nameKey(data["name"] as string);
            try {
              await tx.ingredient.updateMany({
                where: scope,
                data: { name: data["name"] as string, nameKey: key, nameEditedAt: data["nameEditedAt"] as Date },
              });
            } catch (err) {
              if (isUniqueViolation(err)) throw nameTaken();
              throw err;
            }
            return;
          }
          if ("purchase" in data) {
            const p = data["purchase"] as Purchase;
            const claimed = await tx.ingredient.updateMany({
              where: scope,
              data: {
                quantity: p.quantity,
                unit: p.unit,
                price: p.price,
                purchaseEditedAt: data["purchaseEditedAt"] as Date,
              },
            });
            // Only the winning edit writes history, and only when quantity or price really changed.
            if (claimed.count !== 1) return;
            if (Number(current.quantity) !== p.quantity || current.price !== p.price) {
              await recordPurchase(tx, ingredientId, userId, p);
            }
            return;
          }
          if ("default" in data) {
            // The flag's column is `isDefault`; only its time column follows the field name.
            await tx.ingredient.updateMany({
              where: scope,
              data: { isDefault: data["default"] as boolean, defaultEditedAt: data["defaultEditedAt"] as Date },
            });
            return;
          }
          await tx.ingredient.updateMany({ where: scope, data } as Prisma.IngredientUpdateManyArgs);
        });

        // Mode and purchase are separate fields with separate times, so one can win and the other lose.
        // If that leaves a unit that doesn't fit the mode, refuse the whole edit (the transaction rolls back).
        const after = await tx.ingredient.findFirst({ where: { id: ingredientId, projectId } });
        if (after && !unitFits(after.mode, after.unit)) {
          throw new AppError(409, "ingredient_mode_conflict", "That change no longer fits the ingredient's current unit.");
        }
      });

      // Always answer with the current state, even when every change lost.
      const row = await prisma.ingredient.findFirst({
        where: { id: ingredientId, projectId },
        include: ingredientInclude,
      });
      if (!row) throw notFound(); // deleted meanwhile
      res.json(ingredientResponse(row));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:ingredientId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, ingredientId } = await requireIngredient(req, userId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        // The price history goes with it by the database cascade.
        const { count } = await tx.ingredient.deleteMany({ where: { id: ingredientId, projectId } });
        if (count === 0) throw notFound(); // someone else deleted it first
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
