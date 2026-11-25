import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getToken } from "../auth/token-store";
import { ApiError } from "../lib/api";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import { startSyncTriggers } from "../sync/triggers";
import { getActivityUnread, listActivity, markActivityRead, markAllActivityRead, type ActivityItem } from "./api";
import { appendPage, hasUnreadAfter, markAllRead, markRead, unreadIds } from "./list";
import { addPendingRead, clearPendingRead, flushPendingRead, loadPendingRead } from "./pendingRead";

/** idle: not asked yet. loading: first page on its way with nothing to show. error: first page failed with nothing to show. */
export type ActivityStatus = "idle" | "loading" | "ready" | "error";

type ActivityContextValue = {
  status: ActivityStatus;
  items: ActivityItem[];
  /** True when the last fetch could not reach the server; the list on screen is then the saved copy. */
  offline: boolean;
  /** Whether the Home bell shows its dot (R32). */
  hasUnread: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  /** Fetches the first page again (also the screen's "Thử lại"). */
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Re-reads only the unread flag; cheap enough for every time Home comes to the front. */
  refreshUnread: () => Promise<void>;
  /** Marks activity events read here at once and tells the server when it can (R31, R34). */
  markEventsRead: (eventIds: string[]) => void;
  markAllAsRead: () => void;
};

const ActivityContext = createContext<ActivityContextValue | null>(null);

export function useActivity(): ActivityContextValue {
  const value = useContext(ActivityContext);
  if (!value) throw new Error("useActivity must be used inside ActivityProvider");
  return value;
}

type Cache = { items: ActivityItem[]; nextCursor: string | null; hasUnread: boolean };
const cacheKey = (userId: string) => `activity.cache.${userId}`;

/** A refusal that no retry will fix: the saved ids are dropped instead of being sent forever. */
const isFinal = (error: unknown) =>
  error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 429;

/** Remounts the store for each person, so one person's feed never shows for the next. */
export function ActivityProvider({ children }: { children: ReactNode }) {
  const { status, identity } = useAuth();
  const userId = status === "signedIn" ? (identity?.id ?? null) : null;
  return (
    <ActivityStore key={userId ?? "signed-out"} userId={userId}>
      {children}
    </ActivityStore>
  );
}

function ActivityStore({ userId, children }: { userId: string | null; children: ReactNode }) {
  const { handleNotSignedIn, registerSignOutCleanup } = useAuth();

  const [items, setItems] = useState<ActivityItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<ActivityStatus>("idle");
  const [offline, setOffline] = useState(false);
  const [serverUnread, setServerUnread] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const itemsRef = useRef(items);
  const cursorRef = useRef(nextCursor);
  /** What the saved copy holds: the rows and cursor of the first page only. */
  const firstPageRef = useRef<{ count: number; cursor: string | null }>({ count: 0, cursor: null });
  const userRef = useRef(userId);
  const generation = useRef(0);
  const busy = useRef(false);
  const moreBusy = useRef(false);

  const commit = useCallback((next: ActivityItem[], cursor: string | null) => {
    itemsRef.current = next;
    cursorRef.current = cursor;
    setItems(next);
    setNextCursor(cursor);
  }, []);

  const saveCache = useCallback(() => {
    const user = userRef.current;
    if (user === null) return;
    const { count, cursor } = firstPageRef.current;
    const first = itemsRef.current.slice(0, count);
    const cache: Cache = { items: first, nextCursor: cursor, hasUnread: first.some((i) => !i.read) };
    void asyncStorageStore.setJSON(cacheKey(user), cache).catch(() => undefined);
  }, []);

  const authFailed = useCallback(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 401) void handleNotSignedIn();
    },
    [handleNotSignedIn],
  );

  /** Sends what is waiting; settles the unread flag afterwards. */
  const flush = useCallback(async () => {
    const user = userRef.current;
    if (user === null) return;
    const token = await getToken();
    if (!token) return;
    const result = await flushPendingRead(asyncStorageStore, user, (ids) => markActivityRead(token, ids), isFinal).catch(
      () => "failed" as const,
    );
    if (result === "sent" && userRef.current === user) {
      await getActivityUnread(token)
        .then((r) => setServerUnread(r.hasUnread))
        .catch(authFailed);
    }
  }, [authFailed]);

  const refreshUnread = useCallback(async () => {
    const user = userRef.current;
    if (user === null) return;
    const token = await getToken();
    if (!token) return;
    // Reads waiting to be sent would still count as unread on the server.
    if ((await loadPendingRead(asyncStorageStore, user)).length > 0) await flush();
    await getActivityUnread(token)
      .then(async (r) => {
        if (userRef.current !== user) return;
        const waiting = await loadPendingRead(asyncStorageStore, user);
        setServerUnread(r.hasUnread && waiting.length === 0);
      })
      .catch(authFailed);
  }, [authFailed, flush]);

  const refresh = useCallback(async () => {
    const user = userRef.current;
    if (user === null || busy.current) return;
    busy.current = true;
    const gen = generation.current;
    if (itemsRef.current.length === 0) setStatus("loading");
    try {
      const token = await getToken();
      if (!token) return;
      const page = await listActivity(token, null);
      if (generation.current !== gen) return;
      // Reads not yet sent stay read on screen.
      const waiting = await loadPendingRead(asyncStorageStore, user);
      const shown = markRead(page.items, waiting);
      firstPageRef.current = { count: shown.length, cursor: page.nextCursor };
      commit(shown, page.nextCursor);
      setOffline(false);
      setStatus("ready");
      saveCache();
      void refreshUnread();
    } catch (error) {
      if (generation.current !== gen) return;
      authFailed(error);
      setOffline(error instanceof ApiError && error.code === "network");
      setStatus(itemsRef.current.length > 0 ? "ready" : "error");
    } finally {
      busy.current = false;
    }
  }, [authFailed, commit, refreshUnread, saveCache]);

  const loadMore = useCallback(async () => {
    const user = userRef.current;
    const cursor = cursorRef.current;
    if (user === null || cursor === null || moreBusy.current || busy.current) return;
    moreBusy.current = true;
    setLoadingMore(true);
    const gen = generation.current;
    try {
      const token = await getToken();
      if (!token) return;
      const page = await listActivity(token, cursor);
      if (generation.current !== gen) return;
      const waiting = await loadPendingRead(asyncStorageStore, user);
      commit(appendPage(itemsRef.current, { ...page, items: markRead(page.items, waiting) }), page.nextCursor);
    } catch (error) {
      authFailed(error);
    } finally {
      moreBusy.current = false;
      setLoadingMore(false);
    }
  }, [authFailed, commit]);

  const markEventsRead = useCallback(
    (eventIds: string[]) => {
      const user = userRef.current;
      if (user === null || eventIds.length === 0) return;
      commit(markRead(itemsRef.current, eventIds), cursorRef.current);
      saveCache();
      void addPendingRead(asyncStorageStore, user, eventIds)
        .then(() => flush())
        .catch(() => undefined);
    },
    [commit, flush, saveCache],
  );

  const markAllAsRead = useCallback(() => {
    const user = userRef.current;
    if (user === null) return;
    const shownUnread = unreadIds(itemsRef.current);
    commit(markAllRead(itemsRef.current), cursorRef.current);
    setServerUnread(false);
    saveCache();
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        await markAllActivityRead(token);
        await clearPendingRead(asyncStorageStore, user);
      } catch (error) {
        authFailed(error);
        // Not sent: keep what is on screen as waiting reads, to send when the phone is back online.
        if (shownUnread.length > 0) await addPendingRead(asyncStorageStore, user, shownUnread).catch(() => undefined);
      }
    })();
  }, [authFailed, commit, saveCache]);

  // Load the saved copy of this person's feed, then ask the server whether anything is unread.
  useEffect(() => {
    if (userId === null) return;
    let alive = true;
    void (async () => {
      const cache = await asyncStorageStore.getJSON<Cache>(cacheKey(userId)).catch(() => null);
      if (!alive) return;
      if (cache && Array.isArray(cache.items)) {
        firstPageRef.current = { count: cache.items.length, cursor: cache.nextCursor ?? null };
        commit(cache.items, cache.nextCursor ?? null);
        setServerUnread(cache.hasUnread === true);
        setStatus("ready");
      }
      await refreshUnread();
    })().catch(() => undefined);
    return () => {
      alive = false;
    };
    // The store is remounted for each person, so this runs once; the callbacks read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back in front or back online: send the reads that were waiting and re-read the flag.
  useEffect(() => {
    if (userId === null) return;
    return startSyncTriggers(() => void refreshUnread());
  }, [userId, refreshUnread]);

  useEffect(
    () =>
      registerSignOutCleanup(async () => {
        const user = userRef.current;
        if (user === null) return;
        await asyncStorageStore.remove(cacheKey(user)).catch(() => undefined);
        await clearPendingRead(asyncStorageStore, user).catch(() => undefined);
      }),
    [registerSignOutCleanup],
  );

  const value = useMemo<ActivityContextValue>(
    () => ({
      status,
      items,
      offline,
      hasUnread: hasUnreadAfter(items, nextCursor, serverUnread),
      hasMore: nextCursor !== null,
      loadingMore,
      refresh,
      loadMore,
      refreshUnread,
      markEventsRead,
      markAllAsRead,
    }),
    [status, items, offline, nextCursor, serverUnread, loadingMore, refresh, loadMore, refreshUnread, markEventsRead, markAllAsRead],
  );

  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}
