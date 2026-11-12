import type { RefreshResult } from "./syncCycle";

/** `reason`: "offline" when the server couldn't be reached, "server" when it answered with an error. */
export type LoadState = { loaded: boolean; failed: boolean; reason: "offline" | "server" | null };

/** Folds one refresh result in: only "ok" counts as loaded; "offline" and "error" are failures. */
export function nextLoadState(prev: LoadState, result: RefreshResult): LoadState {
  if (result === "ok") return { loaded: true, failed: false, reason: null };
  if (result === "offline") return { ...prev, failed: true, reason: "offline" };
  if (result === "error") return { ...prev, failed: true, reason: "server" };
  return prev;
}

/** What the task list shows: blocks, a load error with Retry, or the list/empty invitation. */
export function taskListState(input: {
  ready: boolean;
  cachedCount: number;
  loaded: boolean;
  failed: boolean;
}): "loading" | "error" | "content" {
  if (!input.ready) return "loading";
  if (input.cachedCount > 0 || input.loaded) return "content";
  return input.failed ? "error" : "loading";
}
