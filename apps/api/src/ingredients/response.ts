import type { Prisma } from "../../generated/prisma/client.js";

/** An ingredient keeps only this many price entries. */
export const PRICE_HISTORY_SIZE = 5;

export const ingredientInclude = {
  prices: {
    orderBy: [{ id: "desc" }],
    take: PRICE_HISTORY_SIZE,
    include: { author: { select: { id: true, displayName: true } } },
  },
} satisfies Prisma.IngredientInclude;

export type IngredientRow = Prisma.IngredientGetPayload<{ include: typeof ingredientInclude }>;

/**
 * The exact shape the phone expects. Quantities leave as plain numbers (at most 3 decimals, so no
 * float drift) and prices as integers in the currency's smallest unit. `prices` is newest first;
 * its first entry is the current price.
 */
export function ingredientResponse(row: IngredientRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    mode: row.mode,
    isDefault: row.isDefault,
    purchase: { quantity: Number(row.quantity), unit: row.unit, price: row.price },
    prices: row.prices.map((p) => ({
      id: p.id,
      quantity: Number(p.quantity),
      unit: p.unit,
      price: p.price,
      author: p.author ? { id: p.author.id, displayName: p.author.displayName } : null,
      recordedAt: p.recordedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}
