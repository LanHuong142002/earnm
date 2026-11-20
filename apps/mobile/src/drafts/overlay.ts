import { SIZE_NAMES, type SizeName } from "../products/types";
import type { Change } from "../sync/queue";
import { DRAFT_ENTITY, DRAFT_LINE_ENTITY, DRAFT_STATUS_ENTITY } from "./entities";
import type { Draft, DraftLineRow } from "./types";

const DRAFT_ENTITIES = [DRAFT_ENTITY, DRAFT_STATUS_ENTITY, DRAFT_LINE_ENTITY];

const isDraftChange = (change: Change, projectId: string) => DRAFT_ENTITIES.includes(change.entity) && change.data.projectId === projectId;

/** The draft a change is about: its own id, or for a line the draft it belongs to. */
const draftIdOf = (change: Change): string => (change.entity === DRAFT_LINE_ENTITY ? String(change.data.draftId) : change.entityId);

const sizeNames = (v: unknown): SizeName[] => (Array.isArray(v) ? SIZE_NAMES.filter((s) => v.includes(s)) : []);

function lineWithFields(line: DraftLineRow, data: Record<string, unknown>): DraftLineRow {
  const next = { ...line };
  if (data.kind === "existing" || data.kind === "new") next.kind = data.kind;
  if (typeof data.ingredientId === "string") next.ingredientId = data.ingredientId;
  if (typeof data.newName === "string") next.newName = data.newName;
  if (data.newKind === "weight" || data.newKind === "volume" || data.newKind === "portion") next.newKind = data.newKind;
  if (data.purchaseQty === null || typeof data.purchaseQty === "number") next.purchaseQty = data.purchaseQty;
  if (data.purchasePrice === null || typeof data.purchasePrice === "number") next.purchasePrice = data.purchasePrice;
  if (typeof data.amount === "number") next.amount = data.amount;
  return next;
}

function withFields(draft: Draft, data: Record<string, unknown>): Draft {
  let next = draft;
  if (typeof data.name === "string") next = { ...next, name: data.name };
  if (Array.isArray(data.sizes)) next = { ...next, sizes: sizeNames(data.sizes) };
  if (data.expectedPrice === null || typeof data.expectedPrice === "number") next = { ...next, expectedPrice: data.expectedPrice };
  if (typeof data.note === "string") next = { ...next, note: data.note };
  return next;
}

function applyToDraft(draft: Draft, change: Change): Draft {
  const { data } = change;
  if (change.entity === DRAFT_STATUS_ENTITY) {
    return data.value === "working" || data.value === "done" ? { ...draft, status: data.value } : draft;
  }
  if (change.entity === DRAFT_LINE_ENTITY) {
    if (change.kind === "delete") return { ...draft, lines: draft.lines.filter((l) => l.id !== change.entityId) };
    const index = draft.lines.findIndex((l) => l.id === change.entityId);
    if (index === -1) {
      if (change.kind !== "create") return draft;
      const blank: DraftLineRow = { id: change.entityId, kind: "existing", ingredientId: null, newName: null, newKind: null, purchaseQty: null, purchasePrice: null, amount: 0 };
      return { ...draft, lines: [...draft.lines, lineWithFields(blank, data)] };
    }
    return { ...draft, lines: draft.lines.map((l, n) => (n === index ? lineWithFields(l, data) : l)) };
  }
  return withFields(draft, data);
}

function created(change: Change, projectId: string): Draft {
  const base: Draft = {
    id: change.entityId,
    projectId,
    name: "",
    sizes: [],
    expectedPrice: null,
    note: "",
    status: "working",
    productId: null,
    convertedAt: null,
    createdAt: change.createdAt,
    lines: [],
  };
  return withFields(base, change.data);
}

/**
 * One project's drafts as the screen shows them: the server's list with the changes still waiting laid over it, in
 * the order they were made. A waiting create is a working draft, an edit shows its new values, a delete hides it.
 * Changes for a draft that is not there are ignored. The list must be the server's.
 */
export function applyDraftOverlay(projectId: string, serverList: Draft[], waiting: Change[]): Draft[] {
  let list = serverList;
  for (const change of waiting) {
    if (!isDraftChange(change, projectId)) continue;
    const id = draftIdOf(change);
    const index = list.findIndex((d) => d.id === id);
    if (change.entity === DRAFT_ENTITY && change.kind === "delete") {
      list = list.filter((d) => d.id !== id);
    } else if (index === -1) {
      if (change.entity === DRAFT_ENTITY && change.kind === "create") list = [...list, created(change, projectId)];
    } else {
      list = list.map((d, n) => (n === index ? applyToDraft(d, change) : d));
    }
  }
  return list;
}

/** The drafts of `projectId` with a change waiting (its own, a line or its status): they show "Chờ lưu". */
export function pendingDraftIds(projectId: string, waiting: Change[]): ReadonlySet<string> {
  return new Set(waiting.filter((c) => isDraftChange(c, projectId)).map(draftIdOf));
}
