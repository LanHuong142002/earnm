import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { getAuth, requireAuth } from "../auth/require-auth.js";
import { AppError } from "../http/errors.js";
import { idSchema, lockedMember, notFound, param, withRetry } from "../ideas/common.js";
import { createIngredientRow } from "../ingredients/create.js";
import { nameKey } from "../labels/nameKey.js";
import { findForMember } from "../projects/access.js";
import { createProductRow } from "../products/create.js";
import type { RecipeLine } from "../products/create.js";
import { MAX_LINE_AMOUNT } from "../products/routes.js";
import { draftInclude, draftMissing, draftResponse } from "./response.js";

const BASE_UNIT = { weight: "g", volume: "ml", portion: "portion" } as const;

/**
 * POST /projects/:projectId/drafts/:draftId/convert: turns a Done draft into a product. Everything
 * happens in one transaction under the project lock, so a refusal or a failure part-way leaves nothing
 * behind and a double tap gets 409 draft_converted.
 */
export function createDraftConvertRouter(deps: { prisma: PrismaClient; now: () => Date }): Router {
  const { prisma, now } = deps;
  const router = Router({ mergeParams: true });
  router.use(requireAuth(deps));

  router.post("/:draftId/convert", async (req, res, next) => {
    try {
      const userId = getAuth(res.locals).userId;
      const projectParsed = idSchema.safeParse(param(req, "projectId"));
      if (!projectParsed.success) throw notFound();
      const projectId = projectParsed.data;
      if (!(await findForMember(prisma, projectId, userId))) throw notFound();
      const draftParsed = idSchema.safeParse(param(req, "draftId"));
      if (!draftParsed.success) throw notFound();
      const draftId = draftParsed.data;

      const result = await withRetry(() =>
        prisma.$transaction(async (tx) => {
          await lockedMember(tx, projectId, userId);
          const draft = await tx.draft.findFirst({ where: { id: draftId, projectId }, include: draftInclude });
          if (!draft) throw notFound();
          if (draft.convertedAt !== null || draft.productId !== null) {
            throw new AppError(409, "draft_converted", "This draft was already turned into a product.");
          }
          if (draft.status !== "done") {
            throw new AppError(409, "draft_not_done", "Mark the draft as done before turning it into a product.");
          }
          const missing = draftMissing(draft);
          if (missing.length > 0) {
            throw new AppError(409, "draft_incomplete", "The draft is missing what it needs to be done.", { missing });
          }

          const at = now();
          const createdIngredients: { id: string; name: string }[] = [];
          const reusedIngredients: { id: string; name: string }[] = [];
          const recipe = new Map<string, number>();
          for (const line of draft.lines) {
            let ingredientId = line.ingredientId;
            if (line.kind === "new") {
              const name = line.newName;
              const mode = line.newKind;
              if (name === null || mode === null) {
                throw new AppError(409, "draft_incomplete", "The draft is missing what it needs to be done.", {
                  missing: [{ code: "line_incomplete", lineId: line.id }],
                });
              }
              const found = await tx.ingredient.findUnique({
                where: { projectId_nameKey: { projectId, nameKey: nameKey(name) } },
                select: { id: true, name: true, mode: true },
              });
              if (found) {
                if (found.mode !== mode) {
                  throw new AppError(
                    409,
                    "draft_ingredient_mode_mismatch",
                    "An ingredient with that name already exists but is counted a different way.",
                    { lineId: line.id, name },
                  );
                }
                ingredientId = found.id;
                if (!reusedIngredients.some((r) => r.id === found.id)) {
                  reusedIngredients.push({ id: found.id, name: found.name });
                }
              } else {
                ingredientId = randomUUID();
                await createIngredientRow(tx, {
                  id: ingredientId,
                  projectId,
                  userId,
                  name,
                  mode,
                  purchase: { quantity: Number(line.purchaseQty), unit: BASE_UNIT[mode], price: line.purchasePrice ?? 0 },
                  isDefault: false,
                  now: at,
                });
                createdIngredients.push({ id: ingredientId, name });
              }
            }
            if (ingredientId === null) continue; // guarded by draftMissing
            // The same ingredient twice (an existing line and a new line that matched it): amounts add up.
            const total = (recipe.get(ingredientId) ?? 0) + Number(line.amount);
            if (total > MAX_LINE_AMOUNT) {
              const ing = await tx.ingredient.findUnique({ where: { id: ingredientId }, select: { name: true } });
              throw new AppError(409, "draft_line_amount_too_large", "Those lines add up to more than one line can hold.", {
                lineId: line.id,
                name: ing?.name ?? "",
              });
            }
            recipe.set(ingredientId, total);
          }

          const productId = randomUUID();
          const lines: RecipeLine[] = [...recipe].map(([ingredientId, amount]) => ({ ingredientId, amount }));
          await createProductRow(tx, {
            id: productId,
            projectId,
            name: draft.name,
            sizes: draft.sizes,
            now: at,
            recipe: lines,
            basePrice: draft.expectedPrice,
          });

          const claimed = await tx.draft.updateMany({
            where: { id: draftId, productId: null, convertedAt: null },
            data: { productId, convertedAt: at },
          });
          if (claimed.count === 0) {
            throw new AppError(409, "draft_converted", "This draft was already turned into a product.");
          }
          const row = await tx.draft.findUniqueOrThrow({ where: { id: draftId }, include: draftInclude });
          return { productId, row, createdIngredients, reusedIngredients };
        }),
      );
      res.status(201).json({
        productId: result.productId,
        draft: draftResponse(result.row),
        createdIngredients: result.createdIngredients,
        reusedIngredients: result.reusedIngredients,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
