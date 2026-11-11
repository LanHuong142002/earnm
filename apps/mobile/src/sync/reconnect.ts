export type NetState = { isConnected: boolean | null; isInternetReachable: boolean | null };

/** Connected and not known to be unreachable (reachability is null while unknown). */
function isUp(state: NetState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

/** True only for a real offline-to-online transition; the first event (prev null) never counts. */
export function isReconnect(prev: NetState | null, next: NetState): boolean {
  return prev !== null && !isUp(prev) && isUp(next);
}
