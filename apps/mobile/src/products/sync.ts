import type { Change, EntityHandlers, NewChange, Queue } from "../sync/queue";
import {
  createExtraCost,
  createFixedCost,
  createProduct,
  deleteExtraCost,
  deleteFixedCost,
  deleteProduct,
  patchExtraCost,
  patchFixedCost,
  patchProduct,
  putSizeLines,
  putSizePrice,
  type ExtraCostFieldPatch,
  type FixedCostFieldPatch,
  type ProductFieldPatch,
} from "./api";
import type { SizeDefaults } from "./defaults";
import { EXTRA_COST_ENTITY, FIXED_COST_ENTITY, PRODUCT_ENTITY, PRODUCT_LINES_ENTITY, PRODUCT_PRICE_ENTITY } from "./entities";
import { FIXED_COST_KINDS, type FixedCostKind, type SizeName, type SizeRecipe } from "./types";

type Deps = {
  createProduct: typeof createProduct;
  patchProduct: typeof patchProduct;
  putSizePrice: typeof putSizePrice;
  putSizeLines: typeof putSizeLines;
  deleteProduct: typeof deleteProduct;
  createExtraCost: typeof createExtraCost;
  patchExtraCost: typeof patchExtraCost;
  deleteExtraCost: typeof deleteExtraCost;
  createFixedCost: typeof createFixedCost;
  patchFixedCost: typeof patchFixedCost;
  deleteFixedCost: typeof deleteFixedCost;
};

const realDeps: Deps = {
  createProduct,
  patchProduct,
  putSizePrice,
  putSizeLines,
  deleteProduct,
  createExtraCost,
  patchExtraCost,
  deleteExtraCost,
  createFixedCost,
  patchFixedCost,
  deleteFixedCost,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timeOf = (change: Change, field: string) => change.fieldTimes[field] ?? change.createdAt;
const projectOf = (change: Change) => String(change.data.projectId);

/** The queue id of one size's price or recipe: edits of one size merge, sizes stay apart. */
export const sizeKey = (productId: string, size: SizeName) => `${productId}|${size}`;

/**
 * Queued product changes. `data` always carries `projectId` (the URL needs it). All of them go through the one shared
 * queue, which sends in the order changes were queued (first in, first out; only changes of the same entity and id
 * merge, never across entities). The screens therefore queue ingredient changes before the product changes that
 * depend on them, and the server sees an ingredient before a recipe that uses it.
 *
 * - product create: `name`, `sizes` and `defaults` (the lines and extras each size starts with, built on the phone so
 *   the product shows its default lines offline; the server builds its own and the reply replaces ours).
 * - product update: only the changed ones of `name` and `sizes` (with `defaults` for the sizes that are new), each
 *   with its own time, so edits merge per field.
 * - price: entity `productPrice`, one per product size, one field `value` (a whole price or null).
 * - recipe: entity `productLines`, one per product size, one field `recipe` (lines and extras replaced as a whole).
 */
export type DefaultsBySize = Partial<Record<SizeName, SizeDefaults>>;

export function productCreateChange(input: {
  id: string;
  projectId: string;
  name: string;
  sizes: SizeName[];
  defaults: DefaultsBySize;
  now: Date;
}): NewChange {
  const at = input.now.toISOString();
  return {
    entity: PRODUCT_ENTITY,
    entityId: input.id,
    kind: "create",
    data: { projectId: input.projectId, name: input.name, sizes: input.sizes, defaults: input.defaults },
    fieldTimes: { name: at, sizes: at, defaults: at },
  };
}

export type ProductFieldChanges = { name?: string; sizes?: SizeName[]; defaults?: DefaultsBySize };

export function productUpdateChange(input: { id: string; projectId: string; fields: ProductFieldChanges; now: Date }): NewChange {
  const at = input.now.toISOString();
  const data: Record<string, unknown> = { projectId: input.projectId };
  const fieldTimes: Record<string, string> = {};
  for (const field of ["name", "sizes", "defaults"] as const) {
    const value = input.fields[field];
    if (value === undefined) continue;
    data[field] = value;
    fieldTimes[field] = at;
  }
  return { entity: PRODUCT_ENTITY, entityId: input.id, kind: "update", data, fieldTimes };
}

export const productDeleteChange = (input: { id: string; projectId: string }): NewChange => ({
  entity: PRODUCT_ENTITY,
  entityId: input.id,
  kind: "delete",
  data: { projectId: input.projectId },
  fieldTimes: {},
});

export function productPriceChange(input: { productId: string; projectId: string; size: SizeName; value: number | null; now: Date }): NewChange {
  return {
    entity: PRODUCT_PRICE_ENTITY,
    entityId: sizeKey(input.productId, input.size),
    kind: "update",
    data: { projectId: input.projectId, productId: input.productId, size: input.size, value: input.value },
    fieldTimes: { value: input.now.toISOString() },
  };
}

export function productLinesChange(input: { productId: string; projectId: string; size: SizeName; recipe: SizeRecipe; now: Date }): NewChange {
  return {
    entity: PRODUCT_LINES_ENTITY,
    entityId: sizeKey(input.productId, input.size),
    kind: "update",
    data: { projectId: input.projectId, productId: input.productId, size: input.size, recipe: input.recipe },
    fieldTimes: { recipe: input.now.toISOString() },
  };
}

export function extraCostCreateChange(input: { id: string; projectId: string; name: string; amount: number; isDefault: boolean; now: Date }): NewChange {
  const at = input.now.toISOString();
  return {
    entity: EXTRA_COST_ENTITY,
    entityId: input.id,
    kind: "create",
    data: { projectId: input.projectId, name: input.name, amount: input.amount, isDefault: input.isDefault },
    fieldTimes: { name: at, amount: at, isDefault: at },
  };
}

export type ExtraCostFieldChanges = { name?: string; amount?: number; isDefault?: boolean };

export function extraCostUpdateChange(input: { id: string; projectId: string; fields: ExtraCostFieldChanges; now: Date }): NewChange {
  const at = input.now.toISOString();
  const data: Record<string, unknown> = { projectId: input.projectId };
  const fieldTimes: Record<string, string> = {};
  for (const field of ["name", "amount", "isDefault"] as const) {
    const value = input.fields[field];
    if (value === undefined) continue;
    data[field] = value;
    fieldTimes[field] = at;
  }
  return { entity: EXTRA_COST_ENTITY, entityId: input.id, kind: "update", data, fieldTimes };
}

export const extraCostDeleteChange = (input: { id: string; projectId: string }): NewChange => ({
  entity: EXTRA_COST_ENTITY,
  entityId: input.id,
  kind: "delete",
  data: { projectId: input.projectId },
  fieldTimes: {},
});

export function fixedCostCreateChange(input: { id: string; projectId: string; name: string; kind: FixedCostKind; amount: number; months: number | null; now: Date }): NewChange {
  const at = input.now.toISOString();
  return {
    entity: FIXED_COST_ENTITY,
    entityId: input.id,
    kind: "create",
    data: { projectId: input.projectId, name: input.name, kind: input.kind, amount: input.amount, months: input.months },
    fieldTimes: { name: at, kind: at, amount: at, months: at },
  };
}

export type FixedCostFieldChanges = { name?: string; kind?: FixedCostKind; amount?: number; months?: number | null };

export function fixedCostUpdateChange(input: { id: string; projectId: string; fields: FixedCostFieldChanges; now: Date }): NewChange {
  const at = input.now.toISOString();
  const data: Record<string, unknown> = { projectId: input.projectId };
  const fieldTimes: Record<string, string> = {};
  for (const field of ["name", "kind", "amount", "months"] as const) {
    const value = input.fields[field];
    if (value === undefined) continue;
    data[field] = value;
    fieldTimes[field] = at;
  }
  return { entity: FIXED_COST_ENTITY, entityId: input.id, kind: "update", data, fieldTimes };
}

export const fixedCostDeleteChange = (input: { id: string; projectId: string }): NewChange => ({
  entity: FIXED_COST_ENTITY,
  entityId: input.id,
  kind: "delete",
  data: { projectId: input.projectId },
  fieldTimes: {},
});

/** Registers the products code with the shared queue; `handlers` receive every result. */
export function registerProductEntities(queue: Queue, handlers: EntityHandlers, deps: Deps = realDeps): void {
  queue.registerEntity(
    PRODUCT_ENTITY,
    {
      create: (change, token) =>
        deps.createProduct(token, projectOf(change), {
          id: change.entityId,
          name: String(change.data.name ?? ""),
          sizes: change.data.sizes as SizeName[],
        }),
      update: (change, token) => {
        const fields: ProductFieldPatch = {};
        const { data } = change;
        if (typeof data.name === "string") fields.name = { value: data.name, editedAt: timeOf(change, "name") };
        if (Array.isArray(data.sizes)) fields.sizes = { value: data.sizes as SizeName[], editedAt: timeOf(change, "sizes") };
        return deps.patchProduct(token, projectOf(change), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteProduct(token, projectOf(change), change.entityId),
    },
    handlers,
  );

  const unsupported = () => Promise.reject(new Error("Not supported."));
  queue.registerEntity(
    PRODUCT_PRICE_ENTITY,
    {
      create: unsupported,
      update: (change, token) =>
        deps.putSizePrice(token, projectOf(change), String(change.data.productId), change.data.size as SizeName, {
          value: change.data.value === null ? null : Number(change.data.value),
          editedAt: timeOf(change, "value"),
        }),
      delete: unsupported,
    },
    handlers,
  );

  queue.registerEntity(
    PRODUCT_LINES_ENTITY,
    {
      create: unsupported,
      update: (change, token) => {
        const recipe = change.data.recipe as SizeRecipe;
        // An extra the phone made up (not yet a server id) goes without an id; the server gives it one.
        const extras = recipe.extras.map(({ id, ...rest }) => (UUID.test(id) ? { id, ...rest } : rest));
        return deps.putSizeLines(token, projectOf(change), String(change.data.productId), change.data.size as SizeName, {
          value: { lines: recipe.lines, extras } as SizeRecipe,
          editedAt: timeOf(change, "recipe"),
        });
      },
      delete: unsupported,
    },
    handlers,
  );

  queue.registerEntity(
    EXTRA_COST_ENTITY,
    {
      create: (change, token) =>
        deps.createExtraCost(token, projectOf(change), {
          id: change.entityId,
          name: String(change.data.name ?? ""),
          amount: Number(change.data.amount ?? 0),
          isDefault: change.data.isDefault === true,
        }),
      update: (change, token) => {
        const fields: ExtraCostFieldPatch = {};
        const { data } = change;
        if (typeof data.name === "string") fields.name = { value: data.name, editedAt: timeOf(change, "name") };
        if (typeof data.amount === "number") fields.amount = { value: data.amount, editedAt: timeOf(change, "amount") };
        if (typeof data.isDefault === "boolean") fields.isDefault = { value: data.isDefault, editedAt: timeOf(change, "isDefault") };
        return deps.patchExtraCost(token, projectOf(change), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteExtraCost(token, projectOf(change), change.entityId),
    },
    handlers,
  );

  queue.registerEntity(
    FIXED_COST_ENTITY,
    {
      create: (change, token) => {
        const kind = (FIXED_COST_KINDS as readonly unknown[]).includes(change.data.kind) ? (change.data.kind as FixedCostKind) : "monthly";
        return deps.createFixedCost(token, projectOf(change), {
          id: change.entityId,
          name: String(change.data.name ?? ""),
          kind,
          amount: Number(change.data.amount ?? 0),
          // A one-time cost needs its months; any other kind has none, even if an edit merged into this create left some.
          months: kind === "oneTime" ? Number(change.data.months) : null,
        });
      },
      update: (change, token) => {
        const fields: FixedCostFieldPatch = {};
        const { data } = change;
        if (typeof data.name === "string") fields.name = { value: data.name, editedAt: timeOf(change, "name") };
        if ((FIXED_COST_KINDS as readonly unknown[]).includes(data.kind)) fields.kind = { value: data.kind as FixedCostKind, editedAt: timeOf(change, "kind") };
        if (typeof data.amount === "number") fields.amount = { value: data.amount, editedAt: timeOf(change, "amount") };
        // Months belong to one-time costs only: a merged edit may carry months a later kind change made stale, and
        // the server clears them itself when the kind moves away from one-time.
        const oneTime = data.kind === undefined || data.kind === "oneTime";
        if (oneTime && (typeof data.months === "number" || data.months === null)) fields.months = { value: data.months, editedAt: timeOf(change, "months") };
        return deps.patchFixedCost(token, projectOf(change), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteFixedCost(token, projectOf(change), change.entityId),
    },
    handlers,
  );
}
