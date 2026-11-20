import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { singleLineText } from "../http/text.js";
import { change, idSchema, lockedMember, notFound, param, withRetry } from "../ideas/common.js";
import type { Tx } from "../ideas/common.js";
import { MAX_PRICE } from "../ingredients/routes.js";
import { nameKey } from "../labels/nameKey.js";
import { findForMember } from "../projects/access.js";
import { assertMoneyInRange, createProductRow, createSizeRow, loadDefaults, MAX_PRODUCTS_PER_PROJECT, productNameTaken } from "./create.js";
import { productInclude, productResponse, SIZE_ORDER } from "./response.js";
import type { SizeName } from "./response.js";

export { MAX_PRODUCTS_PER_PROJECT };
/** Largest recipe amount, in base units (g, ml, portion). */
export const MAX_LINE_AMOUNT = 100_000;
const MAX_LINES_PER_SIZE = 100;
const MAX_EXTRAS_PER_SIZE = 50;

const nameSchema = singleLineText(60);
const sizeSchema = z.enum(SIZE_ORDER);
const sizesSchema = z
  .array(sizeSchema)
  .min(1)
  .max(3)
  .refine((a) => new Set(a).size === a.length, "Sizes must not repeat.");

// Recipe amounts are in base units with at most 3 decimals; 0 is allowed here (a default line to fill in later).
export const amountSchema = z
  .number()
  .min(0)
  .max(MAX_LINE_AMOUNT)
  .refine((q) => Math.abs(q * 1000 - Math.round(q * 1000)) < 1e-6, "At most 3 decimals.");

// The upper bound depends on the project's currency and is checked in the route.
export const moneySchema = z.number().int().min(0).max(MAX_PRICE.VND);

const lineSchema = z
  .object({ ingredientId: z.uuid(), amount: amountSchema, included: z.boolean() })
  .strict();
const extraSchema = z
  .object({
    id: z.uuid().optional(),
    name: singleLineText(40),
    amount: moneySchema,
    included: z.boolean(),
    isDefault: z.boolean(),
    extraCostId: z.uuid().nullable().optional(),
  })
  .strict();
const linesValueSchema = z
  .object({
    lines: z.array(lineSchema).max(MAX_LINES_PER_SIZE),
    extras: z.array(extraSchema).max(MAX_EXTRAS_PER_SIZE),
  })
  .strict();
type LinesValue = z.infer<typeof linesValueSchema>;

const createSchema = z.object({ id: z.uuid(), name: nameSchema, sizes: sizesSchema }).strict();

const patchSchema = z
  .object({
    name: change(nameSchema).optional(),
    sizes: change(sizesSchema).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

const priceSchema = change(moneySchema.nullable());
const linesSchema = change(linesValueSchema);

const nameTaken = productNameTaken;
const invalid = (field: string) => new AppError(400, "validation_failed", `Invalid fields: ${field}.`);

export function createProductsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
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

  async function requireProduct(req: Parameters<typeof param>[0], userId: string) {
    const projectId = await requireMember(param(req, "projectId"), userId);
    const productId = idSchema.safeParse(param(req, "productId"));
    if (!productId.success) throw notFound();
    const found = await prisma.product.findFirst({ where: { id: productId.data, projectId }, select: { id: true } });
    if (!found) throw notFound();
    return { projectId, productId: found.id };
  }

  function sizeParam(req: Parameters<typeof param>[0]): SizeName {
    const parsed = sizeSchema.safeParse(param(req, "size"));
    if (!parsed.success) throw notFound();
    return parsed.data;
  }

  async function loadProduct(productId: string, projectId: string) {
    return prisma.product.findFirst({ where: { id: productId, projectId }, include: productInclude });
  }

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireMember(param(req, "projectId"), userId);
      const rows = await prisma.product.findMany({
        where: { projectId },
        include: productInclude,
        orderBy: [{ nameKey: "asc" }, { id: "asc" }],
      });
      res.json({ products: rows.map(productResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.get("/:productId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, productId } = await requireProduct(req, userId);
      const row = await loadProduct(productId, projectId);
      if (!row) throw notFound();
      res.json(productResponse(row));
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
          const existing = await tx.product.findUnique({ where: { id: body.id }, include: productInclude });
          if (existing) {
            if (existing.projectId !== projectId) {
              throw new AppError(409, "id_conflict", "That product id is already taken.");
            }
            // A retry of a create the phone already sent (offline queue): answer with what was saved,
            // and ignore a body that differs, since the product may have been edited since.
            return { status: 200, row: existing };
          }
          await createProductRow(tx, { id: body.id, projectId, name: body.name, sizes: body.sizes, now: now() });
          const row = await tx.product.findUniqueOrThrow({ where: { id: body.id }, include: productInclude });
          return { status: 201, row };
        }),
      );
      res.status(result.status).json(productResponse(result.row));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:productId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, productId } = await requireProduct(req, userId);
      const body = patchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        if (!(await tx.product.findFirst({ where: { id: productId, projectId }, select: { id: true } }))) {
          throw notFound(); // deleted meanwhile
        }
        await applyLastWriteWins(body, now(), async (where, data) => {
          const scope = { id: productId, projectId, ...where };
          if ("name" in data) {
            try {
              await tx.product.updateMany({
                where: scope,
                data: {
                  name: data["name"] as string,
                  nameKey: nameKey(data["name"] as string),
                  nameEditedAt: data["nameEditedAt"] as Date,
                },
              });
            } catch (err) {
              if (isUniqueViolation(err)) throw nameTaken();
              throw err;
            }
            return;
          }
          // "sizes": the set lives in the size rows; only its time is a column.
          const claimed = await tx.product.updateMany({
            where: scope,
            data: { sizesEditedAt: data["sizesEditedAt"] as Date },
          });
          if (claimed.count !== 1) return;
          const wanted = data["sizes"] as SizeName[];
          await tx.productSizeRow.deleteMany({ where: { productId, size: { notIn: wanted } } });
          const have = new Set(
            (await tx.productSizeRow.findMany({ where: { productId }, select: { size: true } })).map((s) => s.size),
          );
          const missing = wanted.filter((s) => !have.has(s));
          if (missing.length > 0) {
            const defaults = await loadDefaults(tx, projectId);
            for (const size of missing) await createSizeRow(tx, productId, size, defaults);
          }
        });

        // A product always keeps at least one size.
        if ((await tx.productSizeRow.count({ where: { productId } })) === 0) throw invalid("sizes");
      });

      // Always answer with the current state, even when every change lost.
      const row = await loadProduct(productId, projectId);
      if (!row) throw notFound(); // deleted meanwhile
      res.json(productResponse(row));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:productId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, productId } = await requireProduct(req, userId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        // Sizes, recipe lines and extras go with it by the database cascade; ingredients stay.
        const { count } = await tx.product.deleteMany({ where: { id: productId, projectId } });
        if (count === 0) throw notFound(); // someone else deleted it first
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  /** Edits one size's field (`price` or `lines`) with last-write-wins and answers with the whole product. */
  async function editSize(
    req: Request,
    res: Response,
    field: "price" | "lines",
  ): Promise<ReturnType<typeof productResponse>> {
    const userId = getAuth(res.locals).userId;
    const { projectId, productId } = await requireProduct(req, userId);
    const size = sizeParam(req);
    const parsed =
      field === "price"
        ? { price: priceSchema.parse(req.body) }
        : { lines: linesSchema.parse(req.body) };

    await prisma.$transaction(async (tx) => {
      await lockedMember(tx, projectId, userId);
      const sizeRow = await tx.productSizeRow.findFirst({
        where: { productId, size, product: { projectId } },
        include: { lines: true },
      });
      if (!sizeRow) throw notFound(); // deleted or removed meanwhile

      if (parsed.price) {
        const v = parsed.price.value;
        if (v !== null) await assertMoneyInRange(tx, projectId, [v], "value");
      }
      let prepared: PreparedLines | undefined;
      if (parsed.lines) prepared = await prepareLines(tx, projectId, sizeRow, parsed.lines.value);

      await applyLastWriteWins(parsed, now(), async (where, data) => {
        const scope = { id: sizeRow.id, ...where };
        if ("price" in data) {
          await tx.productSizeRow.updateMany({
            where: scope,
            data: { sellingPrice: data["price"] as number | null, priceEditedAt: data["priceEditedAt"] as Date },
          });
          return;
        }
        // "lines": the lines and extras are one field; only its time is a column on the size.
        const claimed = await tx.productSizeRow.updateMany({
          where: scope,
          data: { linesEditedAt: data["linesEditedAt"] as Date },
        });
        if (claimed.count !== 1 || !prepared) return;
        await tx.recipeLine.deleteMany({ where: { sizeId: sizeRow.id } });
        await tx.sizeExtra.deleteMany({ where: { sizeId: sizeRow.id } });
        try {
          await tx.recipeLine.createMany({ data: prepared.lines });
          await tx.sizeExtra.createMany({ data: prepared.extras });
        } catch (err) {
          // An extra id that already belongs to another size.
          if (isUniqueViolation(err)) throw new AppError(409, "id_conflict", "That extra id is already taken.");
          throw err;
        }
      });
    });

    const row = await loadProduct(productId, projectId);
    if (!row) throw notFound(); // deleted meanwhile
    return productResponse(row);
  }

  type PreparedLines = {
    lines: {
      id: string;
      sizeId: string;
      ingredientId: string;
      amount: number;
      included: boolean;
      isDefault: boolean;
      position: number;
    }[];
    extras: {
      id: string;
      sizeId: string;
      name: string;
      amount: number;
      included: boolean;
      isDefault: boolean;
      position: number;
      extraCostId: string | null;
    }[];
  };

  /** Checks a replace-all list against the project and the size's current lines; builds the rows to write. */
  async function prepareLines(
    tx: Tx,
    projectId: string,
    sizeRow: { id: string; lines: { ingredientId: string; isDefault: boolean }[] },
    value: LinesValue,
  ): Promise<PreparedLines> {
    const ids = value.lines.map((l) => l.ingredientId);
    if (new Set(ids).size !== ids.length) throw invalid("lines");
    const found = await tx.ingredient.findMany({ where: { id: { in: ids }, projectId }, select: { id: true } });
    if (found.length !== ids.length) throw invalid("lines"); // an ingredient of another project, or deleted
    // Default lines can be unticked, never removed.
    const wanted = new Set(ids);
    const defaultIds = new Set(sizeRow.lines.filter((l) => l.isDefault).map((l) => l.ingredientId));
    for (const d of defaultIds) if (!wanted.has(d)) throw invalid("lines");
    for (const l of value.lines) {
      if (!defaultIds.has(l.ingredientId) && l.amount <= 0) throw invalid("lines");
    }
    const extraIds = value.extras.flatMap((e) => (e.id ? [e.id] : []));
    if (new Set(extraIds).size !== extraIds.length) throw invalid("extras");
    await assertMoneyInRange(
      tx,
      projectId,
      value.extras.map((e) => e.amount),
      "extras",
    );
    // A link to an extra cost that is gone (or never was this project's) is dropped, not refused.
    const linkIds = [...new Set(value.extras.flatMap((e) => (e.extraCostId ? [e.extraCostId] : [])))];
    const known = new Set(
      (await tx.extraCost.findMany({ where: { id: { in: linkIds }, projectId }, select: { id: true } })).map(
        (x) => x.id,
      ),
    );
    return {
      lines: value.lines.map((l, position) => ({
        id: randomUUID(),
        sizeId: sizeRow.id,
        ingredientId: l.ingredientId,
        amount: l.amount,
        included: l.included,
        isDefault: defaultIds.has(l.ingredientId),
        position,
      })),
      extras: value.extras.map((e, position) => ({
        id: e.id ?? randomUUID(),
        sizeId: sizeRow.id,
        name: e.name,
        amount: e.amount,
        included: e.included,
        isDefault: e.isDefault,
        position,
        extraCostId: e.extraCostId && known.has(e.extraCostId) ? e.extraCostId : null,
      })),
    };
  }

  for (const verb of ["put", "patch"] as const) {
    router[verb]("/:productId/sizes/:size/price", async (req, res, next) => {
      try {
        res.json(await editSize(req, res, "price"));
      } catch (err) {
        next(err);
      }
    });
    router[verb]("/:productId/sizes/:size/lines", async (req, res, next) => {
      try {
        res.json(await editSize(req, res, "lines"));
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
