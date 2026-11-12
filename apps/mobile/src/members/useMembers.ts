import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getToken } from "../auth/token-store";
import { ApiError, listMembers, type Member } from "../lib/api";
import { asyncStorageStore } from "../sync/asyncStorageStore";
import { loadMembers, removeProjectMembers, saveMembers } from "./memberCache";

import type { MembersStatus } from "./screenModel";

export type { MembersStatus };

type State = { key: string; members: Member[] | null; status: MembersStatus };

/** Cached members of a project, refreshed from the server on mount and whenever `refreshKey` changes (focus). */
export function useMembers(projectId: string, refreshKey: unknown = null) {
  // The saved id counts while the profile has not answered, so the members still load and show.
  const { identity } = useAuth();
  const userId = identity?.id ?? null;
  const key = `${userId ?? ""}/${projectId}`;
  const [state, setState] = useState<State>({ key, members: null, status: "loading" });
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const mine = `${userId}/${projectId}`;
    // undefined keeps the saved list (offline); null drops it.
    const apply = (members: Member[] | null | undefined, status: MembersStatus) =>
      setState((s) => {
        if (keyRef.current !== mine) return s;
        const kept = s.key === mine ? s.members : null;
        return { key: mine, members: members === undefined ? kept : members, status };
      });
    try {
      const token = await getToken();
      if (!token) return;
      const list = await listMembers(token, projectId);
      apply(list, "ready");
      if (keyRef.current === mine) await saveMembers(asyncStorageStore, userId, projectId, list).catch(() => {});
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") {
        apply(null, "gone");
        await removeProjectMembers(asyncStorageStore, userId, projectId).catch(() => {});
      } else {
        apply(undefined, "offline"); // network or anything else: keep what is cached
      }
    }
  }, [userId, projectId]);

  // Show the saved copy first.
  useEffect(() => {
    if (!userId) return;
    const mine = `${userId}/${projectId}`;
    let cancelled = false;
    void loadMembers(asyncStorageStore, userId, projectId)
      .catch(() => null)
      .then((cached) => {
        if (cancelled || !cached) return;
        setState((s) => (s.key === mine && s.members ? s : { key: mine, members: cached, status: s.key === mine ? s.status : "loading" }));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, projectId]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const current = state.key === key ? state : { key, members: null, status: "loading" as MembersStatus };
  return { members: current.members, status: current.status, refresh };
}
