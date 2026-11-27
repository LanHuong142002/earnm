import type { IngredientMode } from "../ingredients/types";
import type { SizeName } from "../products/types";

export type DraftStatus = "working" | "done";

/** One recipe line of a draft as the API returns it. Quantities are in base units (g, ml, portion). */
export type DraftLineRow = {
  id: string;
  kind: "existing" | "new";
  /** Set for an `existing` line. */
  ingredientId: string | null;
  /** Set for a `new` line: the ingredient the draft would create when it is converted. */
  newName: string | null;
  newKind: IngredientMode | null;
  purchaseQty: number | null;
  purchasePrice: number | null;
  amount: number;
};

/** The idea a draft was made from, as the API sends it. */
export type DraftIdea = { id: string; title: string };

/** A drink draft exactly as the API returns it (spec R1). */
export type Draft = {
  id: string;
  projectId: string;
  name: string;
  sizes: SizeName[];
  /** Whole minor units; null until set. */
  expectedPrice: number | null;
  note: string;
  status: DraftStatus;
  /** The product it was converted into; null while unconverted, or after that product was deleted. */
  productId: string | null;
  /** Set once converted; a converted draft is read-only even when its product is gone. */
  convertedAt: string | null;
  createdAt: string;
  lines: DraftLineRow[];
  /** The idea this draft was made from; null when it was not, or the idea is gone. */
  ideaId: string | null;
  idea: DraftIdea | null;
  /** How many photos the draft has. */
  photoCount: number;
};

/** What the server says a draft still lacks (`draft_incomplete`). */
export type ServerMissing =
  | { code: "name" | "sizes" | "lines" }
  | { code: "line_price"; lineId: string; name: string }
  | { code: "line_ingredient_missing"; lineId: string };

export type IngredientRef = { id: string; name: string };
