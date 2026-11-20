import { Router } from "express";
import { z } from "zod";
import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
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
import { fixedCostResponse } from "./response.js";

/** A project holds at most this many fixed cost items. */
export const MAX_FIXED_COSTS_PER_PROJECT = 50;

const nameSchema = singleLineText(80);
// The upper bound depends on the project's currency and is checked in the route.
const amountSchema = z.number().int().min(1).max(MAX_PRICE.VND);
const kindSchema = z.enum(["monthly", "weekly", "oneTime"]);
const monthsSchema = z.number().int().min(1).max(120);

const createSchema = z
  .object({
    id: z.uuid(),
    name: nameSchema,
    kind: kindSchema,
    amount: amountSchema,
    months: monthsSchema.nullable().optional(),
  })
  .strict();

const patchSchema = z
  .object({
    name: change(nameSchema).optional(),
    kind: change(kindSchema).optional(),
    amount: change(amountSchema).optional(),
    months: change(monthsSchema.nullable()).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, "At least one field is required.");

const invalid = (field: string) => new AppError(400, "validation_failed", `Invalid fields: ${field}.`);

/** Months belong to one-time items only. */
function assertMonthsMatchKind(kind: string, months: number | null | undefined) {
  if (kind === "oneTime" ? months == null : months != null) throw invalid("months");
}

/** The project's fixed costs (rent, wages, equipment...), spread over each cup by the phone. */
export function createFixedCostsRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
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

  async function requireFixedCost(req: Parameters<typeof param>[0], userId: string) {
    const projectId = await requireMember(param(req, "projectId"), userId);
    const fixedCostId = idSchema.safeParse(param(req, "fixedCostId"));
    if (!fixedCostId.success) throw notFound();
    const found = await prisma.fixedCost.findFirst({
      where: { id: fixedCostId.data, projectId },
      select: { id: true },
    });
    if (!found) throw notFound();
    return { projectId, fixedCostId: found.id };
  }

  async function assertAmountInRange(tx: Tx, projectId: string, amount: number) {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { currency: true } });
    if (!project) throw notFound();
    if (amount > MAX_PRICE[project.currency]) throw invalid("amount");
  }

  /** Names are unique per project, ignoring case; `exceptId` is the item being renamed. */
  async function assertNameFree(tx: Tx, projectId: string, name: string, exceptId?: string) {
    const taken = await tx.fixedCost.findUnique({
      where: { projectId_nameKey: { projectId, nameKey: nameKey(name) } },
      select: { id: true },
    });
    if (taken && taken.id !== exceptId) throw invalid("name");
  }

  router.get("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireMember(param(req, "projectId"), userId);
      const rows = await prisma.fixedCost.findMany({
        where: { projectId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      res.json({ fixedCosts: rows.map(fixedCostResponse) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectId = await requireMember(param(req, "projectId"), userId);
      const body = createSchema.parse(req.body);
      assertMonthsMatchKind(body.kind, body.months);

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          const existing = await tx.fixedCost.findUnique({ where: { id: body.id } });
          if (existing) {
            if (existing.projectId !== projectId) {
              throw new AppError(409, "id_conflict", "That fixed cost id is already taken.");
            }
            // A retry of a create the phone already sent (offline queue).
            return { status: 200, row: existing };
          }
          if ((await tx.fixedCost.count({ where: { projectId } })) >= MAX_FIXED_COSTS_PER_PROJECT) {
            throw new AppError(
              409,
              "fixed_cost_limit_reached",
              `A project can hold at most ${MAX_FIXED_COSTS_PER_PROJECT} fixed costs.`,
            );
          }
          await assertAmountInRange(tx, projectId, body.amount);
          await assertNameFree(tx, projectId, body.name);
          // Field times start at the epoch so a queued edit made after the create always wins.
          const epoch = new Date(0);
          const row = await tx.fixedCost.create({
            data: {
              id: body.id,
              projectId,
              name: body.name,
              nameKey: nameKey(body.name),
              kind: body.kind,
              amount: body.amount,
              months: body.kind === "oneTime" ? (body.months ?? null) : null,
              nameEditedAt: epoch,
              kindEditedAt: epoch,
              amountEditedAt: epoch,
              monthsEditedAt: epoch,
              createdAt: now(),
            },
          });
          return { status: 201, row };
        }),
      );
      res.status(result.status).json(fixedCostResponse(result.row));
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:fixedCostId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, fixedCostId } = await requireFixedCost(req, userId);
      const body = patchSchema.parse(req.body);

      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const stored = await tx.fixedCost.findFirst({ where: { id: fixedCostId, projectId } });
        if (!stored) throw notFound(); // deleted meanwhile

        // A request that contradicts itself is refused. A merely stale kind or months is not: it loses
        // its own last-write-wins and the other fields in the request still apply.
        if (body.kind) {
          if (body.kind.value === "oneTime") {
            if (body.months) assertMonthsMatchKind("oneTime", body.months.value);
            else if (stored.kind !== "oneTime") throw invalid("months");
          } else if (body.months) {
            assertMonthsMatchKind(body.kind.value, body.months.value);
          }
        }
        if (body.amount) await assertAmountInRange(tx, projectId, body.amount.value);
        if (body.name) await assertNameFree(tx, projectId, body.name.value, fixedCostId);

        const capped = (at: Date) => new Date(Math.min(at.getTime(), now().getTime()));

        // 1. Resolve the kind first, and learn whether it won.
        let kindWon = false;
        if (body.kind) {
          const at = capped(body.kind.editedAt);
          const res = await tx.fixedCost.updateMany({
            where: { id: fixedCostId, projectId, kindEditedAt: { lt: at } },
            data: { kind: body.kind.value, kindEditedAt: at },
          });
          kindWon = res.count > 0;
        }
        const afterKind = await tx.fixedCost.findFirst({ where: { id: fixedCostId, projectId } });
        if (!afterKind) throw notFound();

        // 2. Months follow the kind that is stored now: they belong to a one-time cost only.
        if (afterKind.kind !== "oneTime") {
          if (kindWon && stored.kind === "oneTime" && body.kind) {
            await tx.fixedCost.updateMany({
              where: { id: fixedCostId, projectId },
              data: { months: null, monthsEditedAt: capped(body.kind.editedAt) },
            });
          }
          // A months edit for a cost that is not one-time is dropped.
        } else if (body.months) {
          if (body.months.value === null) throw invalid("months");
          if (kindWon && stored.kind !== "oneTime") {
            // The kind just became one-time and had no months: they come with it, whatever their age.
            const at = capped(body.months.editedAt);
            await tx.fixedCost.updateMany({
              where: { id: fixedCostId, projectId },
              data: { months: body.months.value, monthsEditedAt: at > afterKind.monthsEditedAt ? at : afterKind.monthsEditedAt },
            });
          } else {
            await applyLastWriteWins({ months: body.months }, now(), async (where, data) => {
              await tx.fixedCost.updateMany({ where: { id: fixedCostId, projectId, ...where }, data } as Prisma.FixedCostUpdateManyArgs);
            });
          }
        } else if (afterKind.months === null) {
          throw invalid("months"); // a one-time cost always has months
        }

        // 3. The other fields win or lose on their own.
        const { kind: _kind, months: _months, ...others } = body;
        await applyLastWriteWins({ ...others }, now(), async (where, data) => {
          const scope = { id: fixedCostId, projectId, ...where };
          const patch = "name" in data ? { ...data, nameKey: nameKey(data["name"] as string) } : data;
          try {
            await tx.fixedCost.updateMany({ where: scope, data: patch } as Prisma.FixedCostUpdateManyArgs);
          } catch (err) {
            if (isUniqueViolation(err)) throw invalid("name");
            throw err;
          }
        });
      });

      const row = await prisma.fixedCost.findFirst({ where: { id: fixedCostId, projectId } });
      if (!row) throw notFound(); // deleted meanwhile
      res.json(fixedCostResponse(row));
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:fixedCostId", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const { projectId, fixedCostId } = await requireFixedCost(req, userId);
      await prisma.$transaction(async (tx) => {
        await lockedMember(tx, projectId, userId);
        const { count } = await tx.fixedCost.deleteMany({ where: { id: fixedCostId, projectId } });
        if (count === 0) throw notFound();
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
