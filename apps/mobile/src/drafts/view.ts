import { per1 } from "../ingredients/cost";
import { formatUnitCost, type Currency } from "../lib/currency";
import { SIZE_NAMES, type SizeName } from "../products/types";
import type { DoneMissing, DraftEstimate, DraftLine } from "./estimate";
import type { Draft, DraftLineRow } from "./types";

/** The limits the phone enforces before queueing (the same ones the provider checks). */
export const DRAFT_NAME_MAX = 60;
export const DRAFT_NOTE_MAX = 500;

export type DraftGroups = { done: Draft[]; working: Draft[]; converted: Draft[] };

const newestFirst = (a: Draft, b: Draft) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt < b.createdAt ? 1 : -1);

/** The list's sections (mockup A2): Done first, then Working, converted ones apart. Newest first inside each. */
export function groupDrafts(drafts: readonly Draft[]): DraftGroups {
  const groups: DraftGroups = { done: [], working: [], converted: [] };
  for (const d of drafts) {
    if (d.convertedAt !== null) groups.converted.push(d);
    else if (d.status === "done") groups.done.push(d);
    else groups.working.push(d);
  }
  groups.done.sort(newestFirst);
  groups.working.sort(newestFirst);
  groups.converted.sort(newestFirst);
  return groups;
}

/** The count on the project's "Nháp món" tile. */
export function unconvertedCount(drafts: readonly Draft[]): number {
  return drafts.filter((d) => d.convertedAt === null).length;
}

/** The recipe rows as estimate lines. A row the phone cannot read (no ingredient, no name or kind) is left out. */
export function estimateLines(rows: readonly DraftLineRow[]): DraftLine[] {
  const out: DraftLine[] = [];
  for (const r of rows) {
    if (r.kind === "existing") {
      if (r.ingredientId !== null) out.push({ kind: "existing", ingredientId: r.ingredientId, amount: r.amount });
    } else if (r.newName !== null && r.newKind !== null) {
      out.push({ kind: "new", newName: r.newName, newKind: r.newKind, purchaseQty: r.purchaseQty, purchasePrice: r.purchasePrice, amount: r.amount });
    }
  }
  return out;
}

export type RowSummary = { kind: "noRecipe" } | { kind: "missing"; count: number } | { kind: "cost"; total: number };

/** What a list row says after the sizes: the estimated cost, how many prices are missing, or that there is no recipe. */
export function rowSummary(draft: Pick<Draft, "lines">, estimate: DraftEstimate): RowSummary {
  if (draft.lines.length === 0) return { kind: "noRecipe" };
  if (estimate.total === null) return { kind: "missing", count: estimate.missingPrices.length };
  return { kind: "cost", total: estimate.total };
}

const key = (name: string) => name.trim().toLocaleLowerCase("vi");

/** For the confirm dialog (R8): new lines to create as ingredients, and new lines whose name an ingredient now has. */
export function convertSplit(lines: readonly DraftLineRow[], ingredients: readonly { name: string }[]): { create: string[]; reuse: string[] } {
  const known = new Set(ingredients.map((i) => key(i.name)));
  const create: string[] = [];
  const reuse: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.kind !== "new" || line.newName === null) continue;
    const k = key(line.newName);
    if (seen.has(k)) continue;
    seen.add(k);
    (known.has(k) ? reuse : create).push(line.newName);
  }
  return { create, reuse };
}

export type MissingItem = { kind: "name" } | { kind: "sizes" } | { kind: "lines" } | { kind: "price"; name: string } | { kind: "qty"; name: string };

/** The red list of the status sheet: a new line lacking both quantity and price is one "no price" item. */
export function missingItems(missing: readonly DoneMissing[]): MissingItem[] {
  const out: MissingItem[] = [];
  for (const m of missing) {
    if (!("name" in m)) {
      out.push({ kind: m.code });
    } else if (m.code === "newLinePrice") {
      const at = out.findIndex((o) => o.kind === "qty" && o.name === m.name);
      if (at >= 0) out[at] = { kind: "price", name: m.name };
      else out.push({ kind: "price", name: m.name });
    } else if (!out.some((o) => o.kind === "price" && o.name === m.name)) {
      out.push({ kind: "qty", name: m.name });
    }
  }
  return out;
}

const CONVERT_ERROR: Record<string, string> = {
  offline: "offline",
  product_name_taken: "nameTaken",
  pending: "pending",
  product_limit_reached: "productLimit",
  ingredient_limit_reached: "ingredientLimit",
  draft_converted: "converted",
  draft_not_done: "notDone",
  draft_incomplete: "incomplete",
  not_signed_in: "notSignedIn",
};

/** The i18n key of the notice for a failed convert (mockup A11). */
export function convertErrorKey(code: string): string {
  return `drafts.convertErrors.${CONVERT_ERROR[code] ?? "generic"}`;
}

/** "240 ₫/ml": the price of one base unit of a purchase, or "" when there is nothing to divide by. */
export function unitPriceText(purchase: { quantity: number; price: number }, currency: Currency, unitLabel: string): string {
  const one = per1(purchase.price, purchase.quantity);
  return one === null ? "" : `${formatUnitCost(one, currency)}/${unitLabel}`;
}

/** The base size of a draft: the smallest one it has (S, then M, then L). The recipe is for one cup of it. */
export function baseSize(sizes: readonly SizeName[]): SizeName | null {
  return SIZE_NAMES.find((s) => sizes.includes(s)) ?? null;
}
