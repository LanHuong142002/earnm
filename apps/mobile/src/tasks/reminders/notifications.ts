import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

import { deletePushToken, getPushToken, putPushToken, setPushToken } from "../../lib/api";
import { easProjectId, permissionFromResponse, type PermissionState } from "./notificationLogic";
import type { PlannedNotification } from "./scheduler";

/** A notification that arrives while the app is open still shows as a banner (R15). */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function permissionState(): Promise<PermissionState> {
  return permissionFromResponse(await Notifications.getPermissionsAsync());
}

/** Shows iOS's own question. Only called after the explanation sheet (R15). */
export async function requestPermission(): Promise<PermissionState> {
  return permissionFromResponse(await Notifications.requestPermissionsAsync());
}

let applying: Promise<void> = Promise.resolve();

/**
 * Makes the phone's pending local notifications exactly `requests`: everything this app scheduled before is cancelled,
 * then each request is scheduled for its moment. Runs one after another, so a newer plan waits for an older one.
 */
export function applySchedule(requests: PlannedNotification[]): Promise<void> {
  const run = async () => {
    await Notifications.cancelAllScheduledNotificationsAsync();
    if ((await permissionState()) !== "granted") return;
    for (const r of requests) {
      await Notifications.scheduleNotificationAsync({
        identifier: r.identifier,
        content: { title: r.title, body: r.body, data: r.data },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
  };
  applying = applying.then(run, run).catch(() => undefined);
  return applying;
}

/**
 * Registers this phone's Expo push token for the signed-in person (R14). Only with permission and an EAS project id;
 * without either the phone still gets its local notifications. Never throws: push is a bonus.
 */
export async function registerPushToken(authToken: string): Promise<void> {
  try {
    const projectId = easProjectId(Constants.expoConfig?.extra);
    if (projectId === null || (await permissionState()) !== "granted") return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await putPushToken(authToken, data);
    setPushToken(data);
  } catch {
    // No network, or Expo Go without push: try again at the next start.
  }
}

/** Sign-out: this phone's push token leaves the person and nothing stays scheduled (R14). Never throws. */
export async function clearNotificationsOnSignOut(authToken: string | null): Promise<void> {
  const pushToken = getPushToken();
  setPushToken(null);
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // Best effort.
  }
  if (authToken && pushToken) await deletePushToken(authToken, pushToken).catch(() => undefined);
}
