import type { Change } from "../sync/queue";
import { INGREDIENT_ENTITY } from "./entities";
import { INGREDIENT_MODES, type Ingredient, type IngredientMode, type Purchase } from "./types";

const isMode = (v: unknown): v is IngredientMode => (INGREDIENT_MODES as readonly unknown[]).includes(v);
const isPurchase = (v: unknown): v is Purchase =>
  typeof v === "object" && v !== null && typeof (v as Purchase).quantity === "number" && typeof (v as Purchase).price === "number" && typeof (v as Purchase).unit === "string";

const isIngredientChange = (change: Change, projectId: string) => change.entity === INGREDIENT_ENTITY && change.data.projectId === projectId;

/** Applies every field a queued ingredient change carries. */
function withFields(item: Ingredient, data: Record<string, unknown>): Ingredient {
  const next = { ...item };
  if (typeof data.name === "string") next.name = data.name;
  if (isMode(data.mode)) next.mode = data.mode;
  if (isPurchase(data.purchase)) next.purchase = data.purchase;
  if (typeof data.isDefault === "boolean") next.isDefault = data.isDefault;
  return next;
}

function created(change: Change, projectId: string): Ingredient {
  return withFields(
    {
      id: change.entityId,
      projectId,
      name: "",
      mode: "weight",
      isDefault: false,
      purchase: { quantity: 0, unit: "g", price: 0 },
      prices: [],
      createdAt: change.createdAt,
    },
    change.data,
  );
}

/**
 * One project's ingredients as the screen shows them: the server's list with the changes still waiting laid over
 * it, in the order they were made. A waiting create is an ingredient, a waiting edit shows its new values, a waiting
 * delete hides it. Changes for an ingredient that is not there are ignored. The list must be the server's.
 */
export function applyIngredientOverlay(projectId: string, serverList: Ingredient[], waiting: Change[]): Ingredient[] {
  let list = serverList;
  for (const change of waiting) {
    if (!isIngredientChange(change, projectId)) continue;
    const index = list.findIndex((i) => i.id === change.entityId);
    if (change.kind === "delete") {
      list = list.filter((i) => i.id !== change.entityId);
    } else if (index === -1) {
      if (change.kind === "create") list = [...list, created(change, projectId)];
    } else {
      list = list.map((i, n) => (n === index ? withFields(i, change.data) : i));
    }
  }
  return list;
}

/** The ingredients of `projectId` with a change waiting: they show "Chờ lưu". */
export function pendingIngredientIds(projectId: string, waiting: Change[]): ReadonlySet<string> {
  return new Set(waiting.filter((c) => isIngredientChange(c, projectId)).map((c) => c.entityId));
}
