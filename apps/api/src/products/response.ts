import type { Prisma } from "../../generated/prisma/client.js";

export const SIZE_ORDER = ["S", "M", "L"] as const;
export type SizeName = (typeof SIZE_ORDER)[number];

export const productInclude = {
  sizes: {
    include: {
      lines: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      extras: { orderBy: [{ position: "asc" }, { id: "asc" }] },
    },
  },
  /** The drink draft this product was made from, if any. */
  draft: { select: { id: true } },
} satisfies Prisma.ProductInclude;

export type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/**
 * The exact shape the phone expects. Sizes come in S, M, L order. Amounts of recipe lines leave as
 * plain numbers in the ingredient's base unit (at most 3 decimals); extra amounts and selling
 * prices are integers in the currency's smallest unit. The cost is never stored: the phone
 * computes it from the ingredients' current prices.
 */
export function productResponse(row: ProductRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    fromDraftId: row.draft?.id ?? null,
    sizes: [...row.sizes]
      .sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size))
      .map((s) => ({
        size: s.size,
        sellingPrice: s.sellingPrice,
        lines: s.lines.map((l) => ({
          ingredientId: l.ingredientId,
          amount: Number(l.amount),
          included: l.included,
          isDefault: l.isDefault,
        })),
        extras: s.extras.map((e) => ({
          id: e.id,
          name: e.name,
          amount: e.amount,
          included: e.included,
          isDefault: e.isDefault,
          extraCostId: e.extraCostId,
        })),
      })),
  };
}

export function extraCostResponse(row: {
  id: string;
  projectId: string;
  name: string;
  amount: number;
  isDefault: boolean;
  createdAt: Date;
}) {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    amount: row.amount,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
  };
}
