import type { Prisma } from "../../generated/prisma/client.js";
import type { Tx } from "../ideas/common.js";
import { SIZE_ORDER } from "../products/response.js";

export const draftInclude = {
  lines: { orderBy: [{ position: "asc" }, { id: "asc" }] },
  idea: { select: { id: true, title: true } },
  _count: { select: { photos: true } },
} satisfies Prisma.DraftInclude;

export type DraftRow = Prisma.DraftGetPayload<{ include: typeof draftInclude }>;

/** A reason `done` was refused: `code` is one of name, sizes, lines, line_price, line_incomplete, line_ingredient_missing. */
export type MissingItem = { code: string; lineId?: string; name?: string };

/**
 * What a draft still lacks before it can be Done (R5): a name, a size, a line, and a purchase
 * quantity and price on every new line. An existing line whose ingredient was deleted is also listed.
 */
export function draftMissing(draft: DraftRow): MissingItem[] {
  const missing: MissingItem[] = [];
  if (draft.name.trim() === "") missing.push({ code: "name" });
  if (draft.sizes.length === 0) missing.push({ code: "sizes" });
  if (draft.lines.length === 0) missing.push({ code: "lines" });
  for (const line of draft.lines) {
    if (line.kind === "new") {
      if (line.newName === null || line.newKind === null) {
        missing.push({ code: "line_incomplete", lineId: line.id });
      } else if (line.purchaseQty === null || line.purchasePrice === null) {
        missing.push({ code: "line_price", lineId: line.id, name: line.newName ?? "" });
      }
    } else if (line.ingredientId === null) {
      missing.push({ code: "line_ingredient_missing", lineId: line.id });
    }
  }
  return missing;
}

type LineRow = DraftRow["lines"][number];

export function draftLineResponse(line: LineRow) {
  return {
    id: line.id,
    kind: line.kind,
    ingredientId: line.ingredientId,
    newName: line.newName,
    newKind: line.newKind,
    purchaseQty: line.purchaseQty === null ? null : Number(line.purchaseQty),
    purchasePrice: line.purchasePrice,
    amount: Number(line.amount),
  };
}

/** The draft with its lines; cost is never stored. `productId` is null once the product is deleted, `convertedAt` stays. */
export function draftResponse(draft: DraftRow) {
  return {
    id: draft.id,
    projectId: draft.projectId,
    name: draft.name,
    sizes: SIZE_ORDER.filter((s) => draft.sizes.includes(s)),
    expectedPrice: draft.expectedPrice,
    note: draft.note,
    status: draft.status,
    productId: draft.productId,
    ideaId: draft.ideaId,
    idea: draft.idea ? { id: draft.idea.id, title: draft.idea.title } : null,
    photoCount: draft._count.photos,
    convertedAt: draft.convertedAt === null ? null : draft.convertedAt.toISOString(),
    createdAt: draft.createdAt.toISOString(),
    lines: draft.lines.map(draftLineResponse),
  };
}

/** A done draft that an edit left incomplete goes back to working, stamped with the time of the edit. */
export async function reopenIfIncomplete(tx: Tx, draftId: string, at: Date) {
  const row = await tx.draft.findUnique({ where: { id: draftId }, include: draftInclude });
  if (!row || row.status !== "done" || draftMissing(row).length === 0) return;
  await tx.draft.updateMany({ where: { id: draftId, status: "done" }, data: { status: "working", statusEditedAt: at } });
}
