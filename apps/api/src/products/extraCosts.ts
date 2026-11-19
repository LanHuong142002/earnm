import { Router } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { applyLastWriteWins } from "../http/last-write-wins.js";
import { singleLineText } from "../http/text.js";
import { change, idSchema, lockedMember, notFound, param, withRetry } from "../ideas/common.js";
import type { Tx } from "../ideas/common.js";
import { MAX_PRICE } from "../ingredients/routes.js";
import { findForMember } from "../projects/access.js";
import { extraCostResponse } from "./response.js";

/** A project holds at most this many extra costs. */
export const MAX_EXTRA_COSTS_PER_PROJECT = 50;

const nameSchema = singleLineText(40);
// The upper bound depends on the project's currency and is checked in the route.
const amountSchema = z.number().int().min(0).max(MAX_PRICE.VND);

const createSchema = z
  .object({ id: z.uuid(), name: nameSchema, amount: amountSchema, isDefault: z.boolean().default(false) })
  .strict();

const patchSchema = z
  .object({
    name: change(nameSchema).optional(),
    amount: change(amountSchema).optional(),
    isDefault: change(z.boolean()).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

const invalid = (field: string) => new AppError(400, "validation_failed", `Invalid fields: ${field}.`);

/** The project's extra costs (ice, water...). Changing or deleting one never touches existing product sizes. */
export function createExtraCostsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
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

  async function requireExtraCost(req: Parameters<typeof param>[0], userId: string) {
    const projectId = await requireMember(param(req, "projectId"), userId);
    const extraCostId = idSchema.safeParse(param(req, "extraCostId"));
    if (!extraCostId.success) throw notFound();
    const found = await prisma.extraCost.findFirst({
      where: { id: extraCostId.data, projectId },
      select: { id: true },
    });
    if (!found) throw notFound();
    return { projectId, extraCostId: found.id };
  }

  async function assertAmountInRange(tx: Tx, projectId: string, amount: number, field: string) {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { currency: true } });
    if (!project) throw notFound();
    if (amount > MAX_PRICE[project.currency]) throw invalid(field);
  }

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireMember(param(req, "projectId"), userId);
      const rows = await prisma.extraCost.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      res.json({ extraCosts: rows.map(extraCostResponse) });
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
          const existing = await tx.extraCost.findUnique({ where: { id: body.id } });
          if (existing) {
            if (existing.projectId !== projectId) {
              throw new AppError(409, "id_conflict", "That extra cost id is already taken.");
            }
            // A retry of a create the phone already sent (offline queue).
            return { status: 200, row: existing };
          }
          if ((await tx.extraCost.count({ where: { projectId } })) >= MAX_EXTRA_COSTS_PER_PROJECT) {
            throw new AppError(
              409,
              "extra_cost_limit_reached",
              `A project can hold at most ${MAX_EXTRA_COSTS_PER_PROJECT} extra costs.`,
            );
          }
          await assertAmountInRange(tx, projectId, body.amount, "amount");
          const epoch = new Date(0);
          const row = await tx.extraCost.create({
            data: {
              id: body.id,
              projectId,
              name: body.name,
              amount: body.amount,
              isDefault: body.isDefault,
              nameEditedAt: epoch,
              amountEditedAt: epoch,
              defaultEditedAt: epoch,
              createdAt: now(),
            },
          });
          return { status: 201, row };
        }),
      );
      res.status(result.status).json(extraCostResponse(result.row));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:extraCostId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, extraCostId } = await requireExtraCost(req, userId);
      const body = patchSchema.parse(req.body);
      // The stored column for the flag is `isDefault`, but its time is `defaultEditedAt`.
      const { isDefault, ...rest } = body;
      const fields = { ...rest, default: isDefault };

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        if (!(await tx.extraCost.findFirst({ where: { id: extraCostId, projectId }, select: { id: true } }))) {
          throw notFound(); // deleted meanwhile
        }
        if (fields.amount) await assertAmountInRange(tx, projectId, fields.amount.value, "amount");
        await applyLastWriteWins(fields, now(), async (where, data) => {
          const scope = { id: extraCostId, projectId, ...where };
          if ("default" in data) {
            await tx.extraCost.updateMany({
              where: scope,
              data: { isDefault: data["default"] as boolean, defaultEditedAt: data["defaultEditedAt"] as Date },
            });
            return;
          }
          await tx.extraCost.updateMany({ where: scope, data } as Prisma.ExtraCostUpdateManyArgs);
        });
      });

      const row = await prisma.extraCost.findFirst({ where: { id: extraCostId, projectId } });
      if (!row) throw notFound(); // deleted meanwhile
      res.json(extraCostResponse(row));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:extraCostId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, extraCostId } = await requireExtraCost(req, userId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        // Copies on product sizes stay; their link to this extra cost is cleared by the database.
        const { count } = await tx.extraCost.deleteMany({ where: { id: extraCostId, projectId } });
        if (count === 0) throw notFound();
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
