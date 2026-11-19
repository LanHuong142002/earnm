/**
 * The sync cycle for products and extra costs, kept free of React so it can be tested. They share the one write
 * queue (the projects provider flushes it), so this does not flush: it supplies the result `handlers` for
 * `registerProductEntities`, and fetches a project's products and extra costs again when asked.
 *
 * - handlers.onApplied: the cached product (or extra cost) becomes the server's reply (a malformed reply marks the
 *   project for refresh). A price or recipe edit answers with the whole product.
 * - handlers.onRejected: sets the notice and marks the project for refresh, which brings back the server's version.
 * - refresh(projectId): list both and save them. Waiting changes are not saved in the cache.
 * - refreshPending(): after a flush, refresh every project marked above.
 */
import { ApiError } from "../lib/api";
import type { Change, ChangeKind } from "../sync/queue";
import { reasonFor, type RejectedReason } from "../tasks/outcomes";
import { EXTRA_COST_ENTITY, PRODUCT_ENTITY } from "./entities";
import { isExtraCost, isProduct, withExtraCost, withoutExtraCost, withoutProduct, withProduct, type ProjectProducts } from "./store";
import type { ExtraCost, Product } from "./types";

export type ProductRefreshResult = "ok" | "offline" | "error" | "gone" | "skipped";

export type ProductRejectedReason = RejectedReason | "nameTaken";

/** A refused product or extra cost change, for the notice at the top of the screen. */
export type ProductRejectedNotice = {
  /** `product` also covers a price or recipe edit. */
  entity: "product" | "extraCost";
  kind: ChangeKind;
  /** The product's or extra cost's name, when the phone knows it. */
  name: string | null;
  reason: ProductRejectedReason;
};

/** Why the server refused a change for good. */
export function productReasonFor(error: ApiError): ProductRejectedReason {
  if (error.code === "product_name_taken") return "nameTaken";
  if (error.code === "product_limit_reached" || error.code === "extra_cost_limit_reached") return "limit";
  return reasonFor(error);
}

export type ProductSyncCycleDeps = {
  getToken: () => Promise<string | null>;
  listProducts: (token: string, projectId: string) => Promise<Product[]>;
  listExtraCosts: (token: string, projectId: string) => Promise<ExtraCost[]>;
  /** The project's cached lists (the server's, no waiting changes); null when it was never fetched. */
  getEntry: (projectId: string) => ProjectProducts | null;
  /** Shows and saves one project's lists. Writes are applied in the order given. */
  commit: (projectId: string, entry: ProjectProducts) => Promise<unknown>;
  setNotice: (notice: ProductRejectedNotice) => void;
  /** Changes when the session ends or the person changes; late results are then dropped. */
  getGeneration: () => number;
  /** True after the person's own sign-out: nothing may be written. */
  isWiped: () => boolean;
  onNotSignedIn: () => void;
};

export function createProductSyncCycle(deps: ProductSyncCycleDeps) {
  let applyChain: Promise<unknown> = Promise.resolve();
  const marked = new Set<string>();

  const handlers = {
    onApplied: (change: Change, response: unknown) => {
      applyChain = applyChain.then(async () => {
        if (deps.isWiped()) return;
        const projectId = String(change.data.projectId);
        const entry = deps.getEntry(projectId);
        const isExtra = change.entity === EXTRA_COST_ENTITY;
        if (change.kind === "delete") {
          if (entry) {
            await deps.commit(
              projectId,
              isExtra
                ? { ...entry, extraCosts: withoutExtraCost(entry.extraCosts, change.entityId) }
                : { ...entry, products: withoutProduct(entry.products, change.entityId) },
            );
          }
          return;
        }
        // A reply for a project that was never fetched would make a one-item list; the refresh brings the rest.
        if (entry === null) {
          marked.add(projectId);
          return;
        }
        if (isExtra && isExtraCost(response)) {
          await deps.commit(projectId, { ...entry, extraCosts: withExtraCost(entry.extraCosts, response) });
        } else if (!isExtra && isProduct(response)) {
          await deps.commit(projectId, { ...entry, products: withProduct(entry.products, response) });
        } else {
          marked.add(projectId);
        }
      });
    },
    onRejected: (change: Change, error: ApiError) => {
      applyChain = applyChain.then(() => {
        if (deps.isWiped()) return;
        const projectId = String(change.data.projectId);
        const entry = deps.getEntry(projectId);
        const isExtra = change.entity === EXTRA_COST_ENTITY;
        const id = change.entity === PRODUCT_ENTITY || isExtra ? change.entityId : String(change.data.productId);
        const known = isExtra ? entry?.extraCosts.find((x) => x.id === id)?.name : entry?.products.find((p) => p.id === id)?.name;
        const name = known ?? (typeof change.data.name === "string" ? change.data.name : null);
        deps.setNotice({ entity: isExtra ? "extraCost" : "product", kind: change.kind, name, reason: productReasonFor(error) });
        marked.add(projectId);
      });
    },
  };

  async function refresh(projectId: string): Promise<ProductRefreshResult> {
    const gen = deps.getGeneration();
    const token = await deps.getToken();
    if (!token || gen !== deps.getGeneration()) return "skipped";
    try {
      const [products, extraCosts] = await Promise.all([deps.listProducts(token, projectId), deps.listExtraCosts(token, projectId)]);
      if (gen !== deps.getGeneration()) return "skipped";
      await deps.commit(projectId, { products: products.filter(isProduct), extraCosts: extraCosts.filter(isExtraCost) });
      return "ok";
    } catch (error) {
      if (gen !== deps.getGeneration()) return "skipped";
      if (error instanceof ApiError && error.code === "not_signed_in") {
        deps.onNotSignedIn();
        return "skipped";
      }
      if (error instanceof ApiError && error.status === 404) {
        // The project is gone or the person left it: its products are no longer theirs to see.
        await deps.commit(projectId, { products: [], extraCosts: [] });
        return "gone";
      }
      // The cache stays either way; a server that answered with an error is not "offline".
      return error instanceof ApiError && error.code === "network" ? "offline" : "error";
    }
  }

  async function refreshPending(): Promise<void> {
    await applyChain;
    const ids = [...marked];
    marked.clear();
    for (const projectId of ids) {
      // A refresh that failed leaves the project marked, so the next flush retries it.
      const result = await refresh(projectId);
      if (result === "offline" || result === "error") marked.add(projectId);
    }
  }

  return {
    handlers,
    refresh,
    refreshPending,
    /** Resolves when every result received so far has been applied. */
    idle: () => applyChain.then(() => undefined),
    /** Forget pending refreshes (the session ended). */
    reset: () => marked.clear(),
  };
}
