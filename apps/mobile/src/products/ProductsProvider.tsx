import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getStoredUserId, getToken } from "../auth/token-store";
import { useIngredients } from "../ingredients/IngredientsProvider";
import { newProjectId as newId } from "../projects/newProjectId";
import { useProjects } from "../projects/ProjectsProvider";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import type { Change, NewChange } from "../sync/queue";
import { listExtraCosts, listProducts } from "./api";
import { buildDefaults } from "./defaults";
import { PRODUCT_LINES_ENTITY, PRODUCT_PRICE_ENTITY } from "./entities";
import { applyExtraCostOverlay, applyProductOverlay, pendingExtraCostIds, pendingProductIds } from "./overlay";
import {
  clearProductCache,
  emptyProductCache,
  extraCostsOf,
  hasProducts,
  openProductCache,
  productsOf,
  pruneProductCache,
  saveProductCache,
  setProjectProducts,
  type ProductCache,
  type ProjectProducts,
} from "./store";
import {
  extraCostCreateChange,
  extraCostDeleteChange,
  extraCostUpdateChange,
  productCreateChange,
  productDeleteChange,
  productLinesChange,
  productPriceChange,
  productUpdateChange,
  registerProductEntities,
  sizeKey,
  type DefaultsBySize,
  type ExtraCostFieldChanges,
} from "./sync";
import { createProductSyncCycle, type ProductRefreshResult, type ProductRejectedNotice } from "./syncCycle";
import { SIZE_NAMES, type ExtraCost, type Product, type SizeName, type SizeRecipe } from "./types";

export type { ProductRefreshResult, ProductRejectedNotice } from "./syncCycle";
export type { ExtraCostFieldChanges } from "./sync";

/** The server's default target margin, shown until the project's own value is known. */
export const DEFAULT_TARGET_MARGIN = 65;

/** `ok: false` when the provider is not `ready` yet, the product is gone, or the input is not valid. */
export type ProductMutationResult<T = object> = ({ ok: true } & T) | { ok: false };

export type ExtraCostInput = { name: string; amount: number; isDefault?: boolean };

type ProductsContextValue = {
  /** True once the local copy for the signed-in person is loaded. Mutations and refresh wait for it. */
  ready: boolean;
  /** Whether the project's products are known (cached or fetched). Until then a screen shows its skeleton. */
  loadedFor: (projectId: string) => boolean;
  /** The project's products with the waiting changes laid over them. Not sorted (see `order.ts`). */
  productsFor: (projectId: string) => Product[];
  extraCostsFor: (projectId: string) => ExtraCost[];
  /** The project's target profit margin in percent. */
  targetMarginFor: (projectId: string) => number;
  /** The products of the project with a change waiting ("Chờ lưu"). */
  pendingFor: (projectId: string) => ReadonlySet<string>;
  extraCostPendingFor: (projectId: string) => ReadonlySet<string>;
  create: (projectId: string, name: string, sizes: SizeName[]) => Promise<ProductMutationResult<{ id: string }>>;
  rename: (projectId: string, productId: string, name: string) => Promise<ProductMutationResult>;
  /** The product's sizes become `sizes`; a new size starts with the default lines. */
  setSizes: (projectId: string, productId: string, sizes: SizeName[]) => Promise<ProductMutationResult>;
  setPrice: (projectId: string, productId: string, size: SizeName, value: number | null) => Promise<ProductMutationResult>;
  /** Replaces the size's lines and extras as a whole. */
  setLines: (projectId: string, productId: string, size: SizeName, recipe: SizeRecipe) => Promise<ProductMutationResult>;
  remove: (projectId: string, productId: string) => Promise<void>;
  createExtraCost: (projectId: string, input: ExtraCostInput) => Promise<ProductMutationResult<{ id: string }>>;
  updateExtraCost: (projectId: string, extraCostId: string, fields: ExtraCostFieldChanges) => Promise<ProductMutationResult>;
  removeExtraCost: (projectId: string, extraCostId: string) => Promise<void>;
  /** A whole percent from 1 to 95; queued through the project's own sync path. */
  setTargetMargin: (projectId: string, value: number) => Promise<ProductMutationResult>;
  /** Fetches the project's products and extra costs and saves them. "skipped" until `ready`. */
  refresh: (projectId: string) => Promise<ProductRefreshResult>;
  rejectedNotice: ProductRejectedNotice | null;
  dismissRejectedNotice: () => void;
};

const ProductsContext = createContext<ProductsContextValue | null>(null);

export function useProducts(): ProductsContextValue {
  const value = useContext(ProductsContext);
  if (!value) throw new Error("useProducts must be used inside ProductsProvider");
  return value;
}

const NAME_MAX = 60;
const EXTRA_NAME_MAX = 40;
const sortedSizes = (sizes: readonly SizeName[]) => SIZE_NAMES.filter((s) => sizes.includes(s));

export function ProductsProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { registerSignOutCleanup, handleNotSignedIn } = auth;
  const signedIn = auth.status === "signedIn";
  const userId = auth.user?.id ?? null;
  const { sync, projects, status: projectsStatus, update: updateProject } = useProjects();
  const { queue, afterEnqueue, onFlushed, runExclusive } = sync;
  const { ingredientsFor } = useIngredients();

  const [cache, setCache] = useState<ProductCache>(() => emptyProductCache(""));
  const [waiting, setWaiting] = useState<Change[]>([]);
  const [ready, setReady] = useState(false);
  const [rejectedNotice, setRejectedNotice] = useState<ProductRejectedNotice | null>(null);

  const cacheRef = useRef<ProductCache>(cache);
  const readyRef = useRef(false);
  /** Whose copy `cacheRef` is; null until the owner check has run. */
  const loadedOwnerRef = useRef<string | null>(null);
  const genRef = useRef(0);
  /** True from the user's own sign-out until the next sign-in loads; late results must not write storage. */
  const wipedRef = useRef(false);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const notSignedInRef = useRef<() => void>(() => {});

  useEffect(() => {
    notSignedInRef.current = () => void handleNotSignedIn();
  }, [handleNotSignedIn]);

  /** Shows and saves `next`. Saves are written one after another so an older copy never lands last. */
  const publish = useCallback((next: ProductCache): Promise<unknown> => {
    cacheRef.current = next;
    setCache(next);
    if (wipedRef.current || loadedOwnerRef.current === null) return Promise.resolve();
    const write = saveChain.current
      .catch(() => {})
      .then(() => (wipedRef.current ? undefined : saveProductCache(asyncStorageStore, cacheRef.current)))
      .catch(() => {
        // Storage failure: the screen still shows the in-memory list.
      });
    saveChain.current = write;
    return write;
  }, []);

  const commit = useCallback(
    (projectId: string, entry: ProjectProducts) => publish(setProjectProducts(cacheRef.current, projectId, entry)),
    [publish],
  );

  const syncWaiting = useCallback(async () => {
    try {
      setWaiting(await queue.waiting());
    } catch {
      // Unreadable queue: keep showing what is there.
    }
  }, [queue]);

  // The cycle only reads the refs when a result arrives or a refresh runs, never while rendering.
  // eslint-disable-next-line react-hooks/refs -- the closures below are called later, not during render
  const [cycle] = useState(() => {
    const c = createProductSyncCycle({
      getToken,
      listProducts,
      listExtraCosts,
      getEntry: (projectId) => cacheRef.current.byProject[projectId] ?? null,
      commit,
      setNotice: setRejectedNotice,
      getGeneration: () => genRef.current,
      isWiped: () => wipedRef.current,
      onNotSignedIn: () => notSignedInRef.current(),
    });
    registerProductEntities(queue, c.handlers);
    return c;
  });

  const resetMemory = useCallback(() => {
    genRef.current += 1;
    const empty = emptyProductCache("");
    cacheRef.current = empty;
    loadedOwnerRef.current = null;
    readyRef.current = false;
    cycle.reset();
    setCache(empty);
    setWaiting([]);
    setRejectedNotice(null);
    setReady(false);
  }, [cycle]);

  // Load the local copy once the person is known (the stored id when the profile is still offline). The copy of
  // another person is removed by openProductCache.
  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    wipedRef.current = false;
    void (async () => {
      let owner = userId;
      if (!owner) {
        try {
          owner = await getStoredUserId();
        } catch {
          // Unreadable: no saved products are shown until the profile is known.
        }
      }
      if (cancelled || !owner) return;
      let opened: ProductCache;
      try {
        opened = await openProductCache(asyncStorageStore, owner);
      } catch {
        opened = emptyProductCache(owner);
      }
      if (cancelled || wipedRef.current) return;
      cacheRef.current = opened;
      loadedOwnerRef.current = owner;
      setCache(opened);
      await syncWaiting();
      if (cancelled) return;
      readyRef.current = true;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      // The session ended: drop in-memory state only. The user's own sign-out wipes the saved copy below.
      resetMemory();
    };
  }, [signedIn, userId, resetMemory, syncWaiting]);

  // After each flush, fetch again the projects whose changes were refused, and show what is still waiting. Runs
  // behind the flush in the shared exclusive lane so a refresh never reads between a send and its result.
  useEffect(() => {
    return onFlushed(() => {
      void syncWaiting();
      if (!readyRef.current) return;
      void runExclusive(async () => {
        await cycle.refreshPending();
      })
        .catch(() => {})
        .finally(() => void syncWaiting());
    });
  }, [onFlushed, runExclusive, cycle, syncWaiting]);

  // The user's sign-out: every local product copy goes.
  useEffect(() => {
    return registerSignOutCleanup(async () => {
      wipedRef.current = true;
      genRef.current += 1;
      try {
        await clearProductCache(asyncStorageStore);
      } catch {
        // Best effort.
      }
      resetMemory();
    });
  }, [registerSignOutCleanup, resetMemory]);

  // Forget the products of projects that are no longer in the project list. Only once the project list itself has
  // been confirmed by the server, so a cached or empty list never prunes anything.
  useEffect(() => {
    if (!ready || projectsStatus !== "ready") return;
    const pruned = pruneProductCache(cacheRef.current, projects.map((p) => p.id));
    if (Object.keys(pruned.byProject).length !== Object.keys(cacheRef.current.byProject).length) void publish(pruned);
  }, [ready, projectsStatus, projects, publish]);

  const productsShown = useCallback(
    (projectId: string) => applyProductOverlay(projectId, productsOf(cacheRef.current, projectId), waiting),
    [waiting],
  );
  const extraCostsShown = useCallback(
    (projectId: string) => applyExtraCostOverlay(projectId, extraCostsOf(cacheRef.current, projectId), waiting),
    [waiting],
  );

  const productsFor = useCallback<ProductsContextValue["productsFor"]>(
    (projectId) => applyProductOverlay(projectId, productsOf(cache, projectId), waiting),
    [cache, waiting],
  );
  const extraCostsFor = useCallback<ProductsContextValue["extraCostsFor"]>(
    (projectId) => applyExtraCostOverlay(projectId, extraCostsOf(cache, projectId), waiting),
    [cache, waiting],
  );
  const targetMarginFor = useCallback<ProductsContextValue["targetMarginFor"]>(
    (projectId) => projects.find((p) => p.id === projectId)?.targetMargin ?? DEFAULT_TARGET_MARGIN,
    [projects],
  );
  const pendingFor = useCallback<ProductsContextValue["pendingFor"]>((projectId) => pendingProductIds(projectId, waiting), [waiting]);
  const extraCostPendingFor = useCallback<ProductsContextValue["extraCostPendingFor"]>(
    (projectId) => pendingExtraCostIds(projectId, waiting),
    [waiting],
  );
  const loadedFor = useCallback<ProductsContextValue["loadedFor"]>((projectId) => hasProducts(cache, projectId), [cache]);

  const enqueueAll = useCallback(
    async (changes: NewChange[]) => {
      for (const change of changes) await queue.enqueue(change);
      await syncWaiting();
      await afterEnqueue();
    },
    [queue, syncWaiting, afterEnqueue],
  );

  const usable = () => readyRef.current && loadedOwnerRef.current !== null;

  /** What each of `sizes` starts with now: the default ingredients and extra costs (as the person sees them). */
  const defaultsFor = useCallback(
    (projectId: string, productId: string, sizes: readonly SizeName[]): DefaultsBySize => {
      const ingredients = ingredientsFor(projectId);
      const extras = extraCostsShown(projectId);
      return Object.fromEntries(sizes.map((size) => [size, buildDefaults(productId, size, ingredients, extras)]));
    },
    [ingredientsFor, extraCostsShown],
  );

  const create = useCallback<ProductsContextValue["create"]>(
    async (projectId, name, sizes) => {
      if (!usable()) return { ok: false };
      const clean = name.trim();
      const wanted = sortedSizes(sizes);
      if (clean.length === 0 || clean.length > NAME_MAX || wanted.length === 0) return { ok: false };
      const id = newId();
      await enqueueAll([productCreateChange({ id, projectId, name: clean, sizes: wanted, defaults: defaultsFor(projectId, id, wanted), now: new Date() })]);
      return { ok: true, id };
    },
    [enqueueAll, defaultsFor],
  );

  const rename = useCallback<ProductsContextValue["rename"]>(
    async (projectId, productId, name) => {
      if (!usable()) return { ok: false };
      const current = productsShown(projectId).find((p) => p.id === productId);
      const clean = name.trim();
      if (!current || clean.length === 0 || clean.length > NAME_MAX) return { ok: false };
      if (clean !== current.name) await enqueueAll([productUpdateChange({ id: productId, projectId, fields: { name: clean }, now: new Date() })]);
      return { ok: true };
    },
    [productsShown, enqueueAll],
  );

  const setSizes = useCallback<ProductsContextValue["setSizes"]>(
    async (projectId, productId, sizes) => {
      if (!usable()) return { ok: false };
      const current = productsShown(projectId).find((p) => p.id === productId);
      const wanted = sortedSizes(sizes);
      if (!current || wanted.length === 0) return { ok: false };
      const have = current.sizes.map((s) => s.size);
      if (wanted.join() === have.join()) return { ok: true };
      const added = wanted.filter((s) => !have.includes(s));
      await enqueueAll([productUpdateChange({ id: productId, projectId, fields: { sizes: wanted, defaults: defaultsFor(projectId, productId, added) }, now: new Date() })]);
      return { ok: true };
    },
    [productsShown, enqueueAll, defaultsFor],
  );

  const setPrice = useCallback<ProductsContextValue["setPrice"]>(
    async (projectId, productId, size, value) => {
      if (!usable()) return { ok: false };
      if (value !== null && (!Number.isInteger(value) || value < 0)) return { ok: false };
      const current = productsShown(projectId).find((p) => p.id === productId)?.sizes.find((s) => s.size === size);
      if (!current) return { ok: false };
      if (current.sellingPrice !== value) await enqueueAll([productPriceChange({ productId, projectId, size, value, now: new Date() })]);
      return { ok: true };
    },
    [productsShown, enqueueAll],
  );

  const setLines = useCallback<ProductsContextValue["setLines"]>(
    async (projectId, productId, size, recipe) => {
      if (!usable()) return { ok: false };
      const current = productsShown(projectId).find((p) => p.id === productId)?.sizes.find((s) => s.size === size);
      if (!current) return { ok: false };
      await enqueueAll([productLinesChange({ productId, projectId, size, recipe, now: new Date() })]);
      return { ok: true };
    },
    [productsShown, enqueueAll],
  );

  const remove = useCallback<ProductsContextValue["remove"]>(
    async (projectId, productId) => {
      if (!readyRef.current) return;
      const current = productsShown(projectId).find((p) => p.id === productId);
      if (!current) return;
      // Price and recipe edits still waiting for this product have nothing left to apply to.
      for (const { size } of current.sizes) {
        await queue.dropEntity(PRODUCT_PRICE_ENTITY, sizeKey(productId, size));
        await queue.dropEntity(PRODUCT_LINES_ENTITY, sizeKey(productId, size));
      }
      await enqueueAll([productDeleteChange({ id: productId, projectId })]);
    },
    [productsShown, queue, enqueueAll],
  );

  const createExtraCost = useCallback<ProductsContextValue["createExtraCost"]>(
    async (projectId, input) => {
      if (!usable()) return { ok: false };
      const name = input.name.trim();
      if (name.length === 0 || name.length > EXTRA_NAME_MAX || !Number.isInteger(input.amount) || input.amount < 0) return { ok: false };
      const id = newId();
      await enqueueAll([extraCostCreateChange({ id, projectId, name, amount: input.amount, isDefault: input.isDefault ?? false, now: new Date() })]);
      return { ok: true, id };
    },
    [enqueueAll],
  );

  const updateExtraCost = useCallback<ProductsContextValue["updateExtraCost"]>(
    async (projectId, extraCostId, fields) => {
      if (!usable()) return { ok: false };
      const current = extraCostsShown(projectId).find((x) => x.id === extraCostId);
      if (!current) return { ok: false };
      // Only what really changed is queued, so an unchanged field never gets a newer time than another phone's edit.
      const changed: ExtraCostFieldChanges = {};
      if (fields.name !== undefined) {
        const name = fields.name.trim();
        if (name.length === 0 || name.length > EXTRA_NAME_MAX) return { ok: false };
        if (name !== current.name) changed.name = name;
      }
      if (fields.amount !== undefined) {
        if (!Number.isInteger(fields.amount) || fields.amount < 0) return { ok: false };
        if (fields.amount !== current.amount) changed.amount = fields.amount;
      }
      if (fields.isDefault !== undefined && fields.isDefault !== current.isDefault) changed.isDefault = fields.isDefault;
      if (Object.keys(changed).length > 0) {
        await enqueueAll([extraCostUpdateChange({ id: extraCostId, projectId, fields: changed, now: new Date() })]);
      }
      return { ok: true };
    },
    [extraCostsShown, enqueueAll],
  );

  const removeExtraCost = useCallback<ProductsContextValue["removeExtraCost"]>(
    async (projectId, extraCostId) => {
      if (!readyRef.current) return;
      if (!extraCostsShown(projectId).some((x) => x.id === extraCostId)) return;
      await enqueueAll([extraCostDeleteChange({ id: extraCostId, projectId })]);
    },
    [extraCostsShown, enqueueAll],
  );

  const setTargetMargin = useCallback<ProductsContextValue["setTargetMargin"]>(
    async (projectId, value) => {
      if (!usable()) return { ok: false };
      // The project's own sync path queues it, so it merges and flushes with the other project edits.
      const result = await updateProject(projectId, { targetMargin: value });
      return result.ok ? { ok: true } : { ok: false };
    },
    [updateProject],
  );

  const refresh = useCallback<ProductsContextValue["refresh"]>(
    async (projectId) => {
      if (!readyRef.current) return "skipped";
      return runExclusive(async () => {
        await cycle.idle();
        return cycle.refresh(projectId);
      });
    },
    [runExclusive, cycle],
  );

  const dismissRejectedNotice = useCallback(() => setRejectedNotice(null), []);

  const value = useMemo<ProductsContextValue>(
    () => ({
      ready,
      loadedFor,
      productsFor,
      extraCostsFor,
      targetMarginFor,
      pendingFor,
      extraCostPendingFor,
      create,
      rename,
      setSizes,
      setPrice,
      setLines,
      remove,
      createExtraCost,
      updateExtraCost,
      removeExtraCost,
      setTargetMargin,
      refresh,
      rejectedNotice,
      dismissRejectedNotice,
    }),
    [
      ready,
      loadedFor,
      productsFor,
      extraCostsFor,
      targetMarginFor,
      pendingFor,
      extraCostPendingFor,
      create,
      rename,
      setSizes,
      setPrice,
      setLines,
      remove,
      createExtraCost,
      updateExtraCost,
      removeExtraCost,
      setTargetMargin,
      refresh,
      rejectedNotice,
      dismissRejectedNotice,
    ],
  );

  return <ProductsContext.Provider value={value}>{children}</ProductsContext.Provider>;
}
