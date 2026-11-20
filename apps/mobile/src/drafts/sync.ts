import type { IngredientMode } from "../ingredients/types";
import type { SizeName } from "../products/types";
import type { Change, EntityHandlers, NewChange, Queue } from "../sync/queue";
import {
  createDraft,
  createDraftLine,
  deleteDraft,
  deleteDraftLine,
  patchDraft,
  patchDraftLine,
  type CreateDraftLineBody,
  type DraftFieldPatch,
  type DraftLinePatch,
} from "./api";
import { DRAFT_ENTITY, DRAFT_LINE_ENTITY, DRAFT_STATUS_ENTITY } from "./entities";
import type { DraftStatus } from "./types";

type Deps = {
  createDraft: typeof createDraft;
  patchDraft: typeof patchDraft;
  deleteDraft: typeof deleteDraft;
  createDraftLine: typeof createDraftLine;
  patchDraftLine: typeof patchDraftLine;
  deleteDraftLine: typeof deleteDraftLine;
};

const realDeps: Deps = { createDraft, patchDraft, deleteDraft, createDraftLine, patchDraftLine, deleteDraftLine };

const timeOf = (change: Change, field: string) => change.fieldTimes[field] ?? change.createdAt;
const projectOf = (change: Change) => String(change.data.projectId);
const isNumberOrNull = (v: unknown): v is number | null => v === null || typeof v === "number";

/**
 * Queued draft changes. `data` always carries `projectId` (the URL needs it); a line's also carries `draftId`. All of
 * them go through the one shared queue, which sends in the order changes were queued; only changes of the same
 * entity and id merge, per field, each with its own time. So:
 *
 * - draft create / update: `name`, `sizes`, `expectedPrice` (a whole price or null), `note`. An edit made while the
 *   create waits folds into the create.
 * - status: entity `draftStatus`, one per draft, one field `value`. Queued after the lines it depends on.
 * - line: entity `draftLine`, one per line. A create carries the line's fields; edits fold into an unsent create, a
 *   delete of an unsent create drops both. A line edit never merges into another line.
 */
export type DraftFieldChanges = { name?: string; sizes?: SizeName[]; expectedPrice?: number | null; note?: string };

export function draftCreateChange(input: {
  id: string;
  projectId: string;
  name: string;
  sizes: SizeName[];
  expectedPrice: number | null;
  note: string;
  now: Date;
}): NewChange {
  const at = input.now.toISOString();
  return {
    entity: DRAFT_ENTITY,
    entityId: input.id,
    kind: "create",
    data: { projectId: input.projectId, name: input.name, sizes: input.sizes, expectedPrice: input.expectedPrice, note: input.note },
    fieldTimes: { name: at, sizes: at, expectedPrice: at, note: at },
  };
}

export function draftUpdateChange(input: { id: string; projectId: string; fields: DraftFieldChanges; now: Date }): NewChange {
  const at = input.now.toISOString();
  const data: Record<string, unknown> = { projectId: input.projectId };
  const fieldTimes: Record<string, string> = {};
  for (const field of ["name", "sizes", "expectedPrice", "note"] as const) {
    const value = input.fields[field];
    if (value === undefined) continue;
    data[field] = value;
    fieldTimes[field] = at;
  }
  return { entity: DRAFT_ENTITY, entityId: input.id, kind: "update", data, fieldTimes };
}

export const draftDeleteChange = (input: { id: string; projectId: string }): NewChange => ({
  entity: DRAFT_ENTITY,
  entityId: input.id,
  kind: "delete",
  data: { projectId: input.projectId },
  fieldTimes: {},
});

export function draftStatusChange(input: { id: string; projectId: string; value: DraftStatus; now: Date }): NewChange {
  return {
    entity: DRAFT_STATUS_ENTITY,
    entityId: input.id,
    kind: "update",
    data: { projectId: input.projectId, value: input.value },
    fieldTimes: { value: input.now.toISOString() },
  };
}

export type NewDraftLine =
  | { id: string; kind: "existing"; ingredientId: string; amount: number }
  | { id: string; kind: "new"; newName: string; newKind: IngredientMode; purchaseQty: number | null; purchasePrice: number | null; amount: number };

export function draftLineCreateChange(input: { draftId: string; projectId: string; line: NewDraftLine; now: Date }): NewChange {
  const { id, ...fields } = input.line;
  const at = input.now.toISOString();
  return {
    entity: DRAFT_LINE_ENTITY,
    entityId: id,
    kind: "create",
    data: { projectId: input.projectId, draftId: input.draftId, ...fields },
    fieldTimes: Object.fromEntries(Object.keys(fields).map((f) => [f, at])),
  };
}

export type DraftLineFieldChanges = {
  amount?: number;
  newName?: string;
  newKind?: IngredientMode;
  purchaseQty?: number | null;
  purchasePrice?: number | null;
};

export function draftLineUpdateChange(input: { draftId: string; projectId: string; lineId: string; fields: DraftLineFieldChanges; now: Date }): NewChange {
  const at = input.now.toISOString();
  const data: Record<string, unknown> = { projectId: input.projectId, draftId: input.draftId };
  const fieldTimes: Record<string, string> = {};
  for (const field of ["amount", "newName", "newKind", "purchaseQty", "purchasePrice"] as const) {
    const value = input.fields[field];
    if (value === undefined) continue;
    data[field] = value;
    fieldTimes[field] = at;
  }
  return { entity: DRAFT_LINE_ENTITY, entityId: input.lineId, kind: "update", data, fieldTimes };
}

export const draftLineDeleteChange = (input: { draftId: string; projectId: string; lineId: string }): NewChange => ({
  entity: DRAFT_LINE_ENTITY,
  entityId: input.lineId,
  kind: "delete",
  data: { projectId: input.projectId, draftId: input.draftId },
  fieldTimes: {},
});

function lineBody(change: Change): CreateDraftLineBody {
  const { data } = change;
  if (data.kind === "new") {
    return {
      id: change.entityId,
      kind: "new",
      newName: String(data.newName ?? ""),
      newKind: data.newKind as IngredientMode,
      ...(isNumberOrNull(data.purchaseQty) && data.purchaseQty !== null ? { purchaseQty: data.purchaseQty } : {}),
      ...(isNumberOrNull(data.purchasePrice) && data.purchasePrice !== null ? { purchasePrice: data.purchasePrice } : {}),
      amount: Number(data.amount ?? 0),
    };
  }
  return { id: change.entityId, kind: "existing", ingredientId: String(data.ingredientId ?? ""), amount: Number(data.amount ?? 0) };
}

/** Registers the drafts code with the shared queue; `handlers` receive every result. */
export function registerDraftEntities(queue: Queue, handlers: EntityHandlers, deps: Deps = realDeps): void {
  const unsupported = () => Promise.reject(new Error("Not supported."));

  queue.registerEntity(
    DRAFT_ENTITY,
    {
      create: (change, token) => {
        const { data } = change;
        return deps.createDraft(token, projectOf(change), {
          id: change.entityId,
          name: String(data.name ?? ""),
          sizes: data.sizes as SizeName[],
          ...(typeof data.expectedPrice === "number" ? { expectedPrice: data.expectedPrice } : {}),
          ...(typeof data.note === "string" ? { note: data.note } : {}),
        });
      },
      update: (change, token) => {
        const fields: DraftFieldPatch = {};
        const { data } = change;
        if (typeof data.name === "string") fields.name = { value: data.name, editedAt: timeOf(change, "name") };
        if (Array.isArray(data.sizes)) fields.sizes = { value: data.sizes as SizeName[], editedAt: timeOf(change, "sizes") };
        if (isNumberOrNull(data.expectedPrice)) fields.expectedPrice = { value: data.expectedPrice, editedAt: timeOf(change, "expectedPrice") };
        if (typeof data.note === "string") fields.note = { value: data.note, editedAt: timeOf(change, "note") };
        return deps.patchDraft(token, projectOf(change), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteDraft(token, projectOf(change), change.entityId),
    },
    handlers,
  );

  queue.registerEntity(
    DRAFT_STATUS_ENTITY,
    {
      create: unsupported,
      update: (change, token) =>
        deps.patchDraft(token, projectOf(change), change.entityId, {
          status: { value: change.data.value === "done" ? "done" : "working", editedAt: timeOf(change, "value") },
        }),
      delete: unsupported,
    },
    handlers,
  );

  queue.registerEntity(
    DRAFT_LINE_ENTITY,
    {
      create: (change, token) => deps.createDraftLine(token, projectOf(change), String(change.data.draftId), lineBody(change)),
      update: (change, token) => {
        const fields: DraftLinePatch = {};
        const { data } = change;
        if (typeof data.amount === "number") fields.amount = { value: data.amount, editedAt: timeOf(change, "amount") };
        if (typeof data.newName === "string") fields.newName = { value: data.newName, editedAt: timeOf(change, "newName") };
        if (typeof data.newKind === "string") fields.newKind = { value: data.newKind as IngredientMode, editedAt: timeOf(change, "newKind") };
        if (isNumberOrNull(data.purchaseQty)) fields.purchaseQty = { value: data.purchaseQty, editedAt: timeOf(change, "purchaseQty") };
        if (isNumberOrNull(data.purchasePrice)) fields.purchasePrice = { value: data.purchasePrice, editedAt: timeOf(change, "purchasePrice") };
        return deps.patchDraftLine(token, projectOf(change), String(data.draftId), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteDraftLine(token, projectOf(change), String(change.data.draftId), change.entityId),
    },
    handlers,
  );
}
