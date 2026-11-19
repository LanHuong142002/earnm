import { request } from "../lib/api";
import type { ExtraCost, Product, SizeName, SizeRecipe } from "./types";

type Stamped<T> = { value: T; editedAt: string };

export type CreateProductBody = { id: string; name: string; sizes: SizeName[] };
/** Each field has its own time. */
export type ProductFieldPatch = { name?: Stamped<string>; sizes?: Stamped<SizeName[]> };

export type CreateExtraCostBody = { id: string; name: string; amount: number; isDefault?: boolean };
export type ExtraCostFieldPatch = { name?: Stamped<string>; amount?: Stamped<number>; isDefault?: Stamped<boolean> };

const productsBase = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/products`;
const product = (projectId: string, id: string) => `${productsBase(projectId)}/${encodeURIComponent(id)}`;
const extrasBase = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/extra-costs`;
const extra = (projectId: string, id: string) => `${extrasBase(projectId)}/${encodeURIComponent(id)}`;

export const listProducts = (token: string, projectId: string) =>
  request<{ products: Product[] }>(productsBase(projectId), { token }).then((r) => r.products);

export const createProduct = (token: string, projectId: string, body: CreateProductBody) =>
  request<Product>(productsBase(projectId), { method: "POST", body, token });

export const patchProduct = (token: string, projectId: string, id: string, fields: ProductFieldPatch) =>
  request<Product>(product(projectId, id), { method: "PATCH", body: fields, token });

export const putSizePrice = (token: string, projectId: string, id: string, size: SizeName, body: Stamped<number | null>) =>
  request<Product>(`${product(projectId, id)}/sizes/${size}/price`, { method: "PUT", body, token });

export const putSizeLines = (token: string, projectId: string, id: string, size: SizeName, body: Stamped<SizeRecipe>) =>
  request<Product>(`${product(projectId, id)}/sizes/${size}/lines`, { method: "PUT", body, token });

export const deleteProduct = (token: string, projectId: string, id: string) =>
  request<void>(product(projectId, id), { method: "DELETE", token });

export const listExtraCosts = (token: string, projectId: string) =>
  request<{ extraCosts: ExtraCost[] }>(extrasBase(projectId), { token }).then((r) => r.extraCosts);

export const createExtraCost = (token: string, projectId: string, body: CreateExtraCostBody) =>
  request<ExtraCost>(extrasBase(projectId), { method: "POST", body, token });

export const patchExtraCost = (token: string, projectId: string, id: string, fields: ExtraCostFieldPatch) =>
  request<ExtraCost>(extra(projectId, id), { method: "PATCH", body: fields, token });

export const deleteExtraCost = (token: string, projectId: string, id: string) =>
  request<void>(extra(projectId, id), { method: "DELETE", token });
