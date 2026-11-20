export const SIZE_NAMES = ["S", "M", "L"] as const;
export type SizeName = (typeof SIZE_NAMES)[number];

/** One ingredient line of a size's recipe; `amount` is in the ingredient's base unit (g, ml, portion). */
export type ProductLine = { ingredientId: string; amount: number; included: boolean; isDefault: boolean };

/** One extra cost of a size (ice, water...). `extraCostId` links it to the project's extra cost it was copied from. */
export type ProductExtra = {
  id: string;
  name: string;
  amount: number;
  included: boolean;
  isDefault: boolean;
  extraCostId: string | null;
};

export type ProductSize = {
  size: SizeName;
  /** Whole minor units; null until set. */
  sellingPrice: number | null;
  lines: ProductLine[];
  extras: ProductExtra[];
};

/** A product exactly as the API returns it (spec R13). */
/** `fromDraftId` is the draft it was converted from; absent in copies saved before drafts existed. */
export type Product = { id: string; projectId: string; name: string; createdAt: string; sizes: ProductSize[]; fromDraftId?: string | null };

/** The recipe part the person edits: replaces a size's lines and extras as a whole. */
export type SizeRecipe = {
  lines: { ingredientId: string; amount: number; included: boolean }[];
  extras: { id: string; name: string; amount: number; included: boolean; isDefault: boolean; extraCostId: string | null }[];
};

export type ExtraCost = { id: string; projectId: string; name: string; amount: number; isDefault: boolean; createdAt: string };
