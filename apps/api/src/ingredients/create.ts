import { AppError } from "../http/errors.js";
import { isUniqueViolation } from "../http/prisma-errors.js";
import { notFound } from "../ideas/common.js";
import type { Tx } from "../ideas/common.js";
import { nameKey } from "../labels/nameKey.js";
import { PRICE_HISTORY_SIZE } from "./response.js";

/** A project holds at most this many ingredients. */
export const MAX_INGREDIENTS_PER_PROJECT = 300;

/** Largest price in the currency's smallest unit: 1.000.000.000 ₫, or 100.000 $ in cents. */
export const MAX_PRICE: Record<"VND" | "USD", number> = { VND: 1_000_000_000, USD: 10_000_000 };
/** Largest quantity, in base units (g, ml, portion). */
export const MAX_QUANTITY = 1_000_000;

export type Purchase = { quantity: number; unit: "kg" | "g" | "l" | "ml" | "portion"; price: number };

export const ingredientNameTaken = () =>
  new AppError(409, "ingredient_name_taken", "An ingredient in this project already has that name.");

/** Throws 400 when the price is above the maximum for the project's currency. Run inside the write's transaction. */
export async function assertPriceInRange(tx: Tx, projectId: string, price: number): Promise<void> {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { currency: true } });
  if (!project) throw notFound();
  if (price > MAX_PRICE[project.currency]) {
    throw new AppError(400, "validation_failed", "Invalid fields: purchase.");
  }
}

/** Records a purchase in the history and keeps only the latest few. */
export async function recordPurchase(tx: Tx, ingredientId: string, userId: string, p: Purchase, at: Date) {
  await tx.ingredientPrice.create({
    data: {
      ingredientId,
      quantity: p.quantity,
      unit: p.unit,
      price: p.price,
      authorId: userId,
      recordedAt: at,
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

/**
 * Creates an ingredient inside the caller's transaction (which must already hold the project lock):
 * the 300 limit, the name check, the price range, the row and its first price in the history.
 * Throws 409 ingredient_limit_reached or ingredient_name_taken.
 */
export async function createIngredientRow(
  tx: Tx,
  input: {
    id: string;
    projectId: string;
    userId: string;
    name: string;
    mode: "weight" | "volume" | "portion";
    purchase: Purchase;
    isDefault: boolean;
    now: Date;
  },
): Promise<void> {
  const { id, projectId, userId, name, mode, purchase, isDefault, now } = input;
  // Counted under the project lock, so concurrent creates can't pass the limit together.
  if ((await tx.ingredient.count({ where: { projectId } })) >= MAX_INGREDIENTS_PER_PROJECT) {
    throw new AppError(
      409,
      "ingredient_limit_reached",
      `A project can hold at most ${MAX_INGREDIENTS_PER_PROJECT} ingredients.`,
    );
  }
  const key = nameKey(name);
  if (await tx.ingredient.findUnique({ where: { projectId_nameKey: { projectId, nameKey: key } } })) {
    throw ingredientNameTaken();
  }
  await assertPriceInRange(tx, projectId, purchase.price);
  // Field times start at the epoch so a queued edit made after the create always wins.
  const epoch = new Date(0);
  try {
    await tx.ingredient.create({
      data: {
        id,
        projectId,
        name,
        nameKey: key,
        mode,
        quantity: purchase.quantity,
        unit: purchase.unit,
        price: purchase.price,
        isDefault,
        nameEditedAt: epoch,
        modeEditedAt: epoch,
        purchaseEditedAt: epoch,
        defaultEditedAt: epoch,
        createdAt: now,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw ingredientNameTaken();
    throw err;
  }
  await recordPurchase(tx, id, userId, purchase, now);
}
