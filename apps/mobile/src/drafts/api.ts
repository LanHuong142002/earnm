import { request } from "../lib/api";
import type { IngredientMode } from "../ingredients/types";
import type { SizeName } from "../products/types";
import type { Draft, DraftStatus, IngredientRef } from "./types";

type Stamped<T> = { value: T; editedAt: string };

export type CreateDraftBody = { id: string; name: string; sizes: SizeName[]; expectedPrice?: number | null; note?: string };
/** Each field has its own time. */
export type DraftFieldPatch = {
  name?: Stamped<string>;
  sizes?: Stamped<SizeName[]>;
  expectedPrice?: Stamped<number | null>;
  note?: Stamped<string>;
  status?: Stamped<DraftStatus>;
};

export type CreateDraftLineBody =
  | { id: string; kind: "existing"; ingredientId: string; amount: number }
  | { id: string; kind: "new"; newName: string; newKind: IngredientMode; purchaseQty?: number | null; purchasePrice?: number | null; amount: number };
export type DraftLinePatch = {
  amount?: Stamped<number>;
  newName?: Stamped<string>;
  newKind?: Stamped<IngredientMode>;
  purchaseQty?: Stamped<number | null>;
  purchasePrice?: Stamped<number | null>;
};

export type ConvertReply = { productId: string; draft: Draft; createdIngredients: IngredientRef[]; reusedIngredients: IngredientRef[] };

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/drafts`;
const one = (projectId: string, id: string) => `${base(projectId)}/${encodeURIComponent(id)}`;
const lineOf = (projectId: string, id: string, lineId: string) => `${one(projectId, id)}/lines/${encodeURIComponent(lineId)}`;

export const listDrafts = (token: string, projectId: string) => request<{ drafts: Draft[] }>(base(projectId), { token }).then((r) => r.drafts);

export const createDraft = (token: string, projectId: string, body: CreateDraftBody) =>
  request<Draft>(base(projectId), { method: "POST", body, token });

export const patchDraft = (token: string, projectId: string, id: string, fields: DraftFieldPatch) =>
  request<Draft>(one(projectId, id), { method: "PATCH", body: fields, token });

export const deleteDraft = (token: string, projectId: string, id: string) => request<void>(one(projectId, id), { method: "DELETE", token });

export const createDraftLine = (token: string, projectId: string, id: string, body: CreateDraftLineBody) =>
  request<Draft>(`${one(projectId, id)}/lines`, { method: "POST", body, token });

export const patchDraftLine = (token: string, projectId: string, id: string, lineId: string, fields: DraftLinePatch) =>
  request<Draft>(lineOf(projectId, id, lineId), { method: "PATCH", body: fields, token });

export const deleteDraftLine = (token: string, projectId: string, id: string, lineId: string) =>
  request<void>(lineOf(projectId, id, lineId), { method: "DELETE", token });

/** Needs the network: converting is never queued. */
export const convertDraft = (token: string, projectId: string, id: string) =>
  request<ConvertReply>(`${one(projectId, id)}/convert`, { method: "POST", token });
