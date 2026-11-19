import type { Change, EntityHandlers, NewChange, Queue } from "../sync/queue";
import { createIngredient, deleteIngredient, patchIngredient, type IngredientFieldPatch } from "./api";
import { INGREDIENT_ENTITY } from "./entities";
import type { IngredientMode, Purchase } from "./types";

type Deps = {
  createIngredient: typeof createIngredient;
  patchIngredient: typeof patchIngredient;
  deleteIngredient: typeof deleteIngredient;
};

const realDeps: Deps = { createIngredient, patchIngredient, deleteIngredient };

const timeOf = (change: Change, field: string) => change.fieldTimes[field] ?? change.createdAt;
const projectOf = (change: Change) => String(change.data.projectId);

/**
 * Queued ingredient changes. `data` always carries `projectId` (the URL needs it).
 * - create: `name`, `mode`, `purchase` (the whole {quantity, unit, price}) and `isDefault`. An edit made while the
 *   create waits folds into it.
 * - update: only the changed ones of `name`, `mode`, `purchase`, `isDefault`, each with its own time, so changes
 *   merge per field and quick edits of one ingredient leave one request. `purchase` is one field, never merged inside.
 */
export function ingredientCreateChange(input: {
  id: string;
  projectId: string;
  name: string;
  mode: IngredientMode;
  purchase: Purchase;
  isDefault?: boolean;
  now: Date;
}): NewChange {
  const at = input.now.toISOString();
  return {
    entity: INGREDIENT_ENTITY,
    entityId: input.id,
    kind: "create",
    data: {
      projectId: input.projectId,
      name: input.name,
      mode: input.mode,
      purchase: input.purchase,
      isDefault: input.isDefault ?? false,
    },
    fieldTimes: { name: at, mode: at, purchase: at, isDefault: at },
  };
}

export type IngredientFieldChanges = { name?: string; mode?: IngredientMode; purchase?: Purchase; isDefault?: boolean };

/** A mode change must carry the purchase (the unit has to fit the mode), so one without it is refused here. */
export function ingredientUpdateChange(input: {
  id: string;
  projectId: string;
  fields: IngredientFieldChanges;
  now: Date;
}): NewChange {
  const { fields } = input;
  if (fields.mode !== undefined && fields.purchase === undefined) {
    throw new Error("A mode change must come with its purchase.");
  }
  const at = input.now.toISOString();
  const data: Record<string, unknown> = { projectId: input.projectId };
  const fieldTimes: Record<string, string> = {};
  for (const field of ["name", "mode", "purchase", "isDefault"] as const) {
    const value = fields[field];
    if (value === undefined) continue;
    data[field] = value;
    fieldTimes[field] = at;
  }
  return { entity: INGREDIENT_ENTITY, entityId: input.id, kind: "update", data, fieldTimes };
}

export function ingredientDeleteChange(input: { id: string; projectId: string }): NewChange {
  return { entity: INGREDIENT_ENTITY, entityId: input.id, kind: "delete", data: { projectId: input.projectId }, fieldTimes: {} };
}

/** Registers ingredients with the shared queue; `handlers` receive every result. */
export function registerIngredientEntities(queue: Queue, handlers: EntityHandlers, deps: Deps = realDeps): void {
  queue.registerEntity(
    INGREDIENT_ENTITY,
    {
      create: (change, token) => {
        const { data } = change;
        return deps.createIngredient(token, projectOf(change), {
          id: change.entityId,
          name: String(data.name ?? ""),
          mode: data.mode as IngredientMode,
          isDefault: data.isDefault === true,
          purchase: data.purchase as Purchase,
        });
      },
      update: (change, token) => {
        const fields: IngredientFieldPatch = {};
        const { data } = change;
        if (typeof data.name === "string") fields.name = { value: data.name, editedAt: timeOf(change, "name") };
        if (typeof data.mode === "string") fields.mode = { value: data.mode as IngredientMode, editedAt: timeOf(change, "mode") };
        if (data.purchase && typeof data.purchase === "object") {
          fields.purchase = { value: data.purchase as Purchase, editedAt: timeOf(change, "purchase") };
        }
        if (typeof data.isDefault === "boolean") fields.isDefault = { value: data.isDefault, editedAt: timeOf(change, "isDefault") };
        return deps.patchIngredient(token, projectOf(change), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteIngredient(token, projectOf(change), change.entityId),
    },
    handlers,
  );
}
