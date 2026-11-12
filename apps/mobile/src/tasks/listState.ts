import type { RefreshResult } from "./syncCycle";

export type LoadState = { loaded: boolean; failed: boolean };

/** Folds one refresh result in: only "ok" counts as loaded; "offline" is a failure. */
export function nextLoadState(prev: LoadState, result: RefreshResult): LoadState {
  if (result === "ok") return { loaded: true, failed: false };
  if (result === "offline") return { ...prev, failed: true };
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
