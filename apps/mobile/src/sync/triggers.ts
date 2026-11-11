import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";

import { isReconnect, type NetState } from "./reconnect";

/** Calls `flush` when the app returns to the foreground or the connection comes back. */
export function startSyncTriggers(flush: () => void): () => void {
  const appSub = AppState.addEventListener("change", (state) => {
    if (state === "active") flush();
  });
  let prev: NetState | null = null;
  const unsubscribeNet = NetInfo.addEventListener((state) => {
    const next: NetState = { isConnected: state.isConnected, isInternetReachable: state.isInternetReachable };
    const reconnected = isReconnect(prev, next);
    prev = next;
    if (reconnected) flush();
  });
  return () => {
    appSub.remove();
    unsubscribeNet();
  };
}
