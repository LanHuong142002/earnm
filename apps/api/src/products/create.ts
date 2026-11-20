import { randomUUID } from "node:crypto";
import { AppError } from "../http/errors.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { notFound } from "../ideas/common.js";
import type { Tx } from "../ideas/common.js";
import { MAX_PRICE } from "../ingredients/create.js";
import { nameKey } from "../labels/nameKey.js";
import { SIZE_ORDER } from "./response.js";
import type { SizeName } from "./response.js";

/** A project holds at most this many products. */
export const MAX_PRODUCTS_PER_PROJECT = 200;

export const productNameTaken = () =>
  new AppError(409, "product_name_taken", "A product in this project already has that name.");

/** Throws 400 when an amount is above the maximum for the project's currency. Run inside the write's transaction. */
export async function assertMoneyInRange(tx: Tx, projectId: string, amounts: number[], field: string) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { currency: true } });
  if (!project) throw notFound();
  if (amounts.some((a) => a > MAX_PRICE[project.currency])) {
    throw new AppError(400, "validation_failed", `Invalid fields: ${field}.`);
  }
}

/** What a new size starts with: a ticked line per default ingredient and a copy of each default extra cost. */
export async function loadDefaults(tx: Tx, projectId: string) {
  const [ingredients, extraCosts] = await Promise.all([
    tx.ingredient.findMany({
      where: { projectId, isDefault: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, mode: true },
    }),
    tx.extraCost.findMany({
      where: { projectId, isDefault: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  return { ingredients, extraCosts };
}

export type SizeDefaults = Awaited<ReturnType<typeof loadDefaults>>;

/** Recipe lines added to a new size on top of its defaults. A default ingredient listed here takes this amount. */
export type RecipeLine = { ingredientId: string; amount: number };

export async function createSizeRow(
  tx: Tx,
  productId: string,
  size: SizeName,
  defaults: SizeDefaults,
  options: { recipe?: RecipeLine[] | undefined; sellingPrice?: number | null | undefined } = {},
) {
  // Field times start at the epoch so a queued edit made after the create always wins.
  const epoch = new Date(0);
  const recipe = new Map((options.recipe ?? []).map((l) => [l.ingredientId, l.amount]));
  const defaultIds = new Set(defaults.ingredients.map((i) => i.id));
  const lines = [
    ...defaults.ingredients.map((ing) => ({
      ingredientId: ing.id,
      // Portion ingredients start at one portion; weights and volumes are filled in by the person.
      amount: recipe.get(ing.id) ?? (ing.mode === "portion" ? 1 : 0),
      isDefault: true,
    })),
    ...(options.recipe ?? [])
      .filter((l) => !defaultIds.has(l.ingredientId))
      .map((l) => ({ ingredientId: l.ingredientId, amount: l.amount, isDefault: false })),
  ];
  await tx.productSizeRow.create({
    data: {
      id: randomUUID(),
      productId,
      size,
      sellingPrice: options.sellingPrice ?? null,
      priceEditedAt: epoch,
      linesEditedAt: epoch,
      lines: {
        create: lines.map((l, position) => ({
          id: randomUUID(),
          ingredientId: l.ingredientId,
          amount: l.amount,
          included: true,
          isDefault: l.isDefault,
          position,
        })),
      },
      extras: {
        create: defaults.extraCosts.map((x, position) => ({
          id: randomUUID(),
          name: x.name,
          amount: x.amount,
          included: true,
          isDefault: true,
          position,
          extraCostId: x.id,
        })),
      },
    },
  });
}

/**
 * Creates a product with its sizes inside the caller's transaction (which must already hold the
 * project lock): the 200 limit, the name check, then each size with the project's defaults.
 * `recipe` and `basePrice` are for a product made from a draft: the recipe goes into every size and
 * the price into the smallest size. Throws 409 product_limit_reached or product_name_taken.
 */
export async function createProductRow(
  tx: Tx,
  input: {
    id: string;
    projectId: string;
    name: string;
    sizes: readonly SizeName[];
    now: Date;
    recipe?: RecipeLine[];
    basePrice?: number | null;
  },
): Promise<void> {
  const { id, projectId, name, sizes, now } = input;
  // Counted under the project lock, so concurrent creates can't pass the limit together.
  if ((await tx.product.count({ where: { projectId } })) >= MAX_PRODUCTS_PER_PROJECT) {
    throw new AppError(409, "product_limit_reached", `A project can hold at most ${MAX_PRODUCTS_PER_PROJECT} products.`);
  }
  const key = nameKey(name);
  if (await tx.product.findUnique({ where: { projectId_nameKey: { projectId, nameKey: key } } })) {
    throw productNameTaken();
  }
  const epoch = new Date(0);
  try {
    await tx.product.create({
      data: { id, projectId, name, nameKey: key, nameEditedAt: epoch, sizesEditedAt: epoch, createdAt: now },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw productNameTaken();
    throw err;
  }
  const defaults = await loadDefaults(tx, projectId);
  const base = [...sizes].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b))[0];
  for (const size of sizes) {
    await createSizeRow(tx, id, size, defaults, {
      recipe: input.recipe,
      sellingPrice: size === base ? (input.basePrice ?? null) : null,
    });
  }
}
