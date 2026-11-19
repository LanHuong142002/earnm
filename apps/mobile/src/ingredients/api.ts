import { request } from "../lib/api";
import type { Ingredient, IngredientMode, Purchase } from "./types";

type Stamped<T> = { value: T; editedAt: string };

export type CreateIngredientBody = {
  id: string;
  name: string;
  mode: IngredientMode;
  isDefault?: boolean;
  purchase: Purchase;
};

/** Each field has its own time. `purchase` is one field: the whole {quantity, unit, price}. A mode change sends mode and purchase together. */
export type IngredientFieldPatch = {
  name?: Stamped<string>;
  mode?: Stamped<IngredientMode>;
  purchase?: Stamped<Purchase>;
  isDefault?: Stamped<boolean>;
};

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/ingredients`;
const one = (projectId: string, id: string) => `${base(projectId)}/${encodeURIComponent(id)}`;

export const listIngredients = (token: string, projectId: string) =>
  request<{ ingredients: Ingredient[] }>(base(projectId), { token }).then((r) => r.ingredients);

export const createIngredient = (token: string, projectId: string, body: CreateIngredientBody) =>
  request<Ingredient>(base(projectId), { method: "POST", body, token });

export const patchIngredient = (token: string, projectId: string, id: string, fields: IngredientFieldPatch) =>
  request<Ingredient>(one(projectId, id), { method: "PATCH", body: fields, token });

export const deleteIngredient = (token: string, projectId: string, id: string) =>
  request<void>(one(projectId, id), { method: "DELETE", token });
