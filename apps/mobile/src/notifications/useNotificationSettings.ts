import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";

import { useAuth } from "../auth/AuthProvider";
import { getToken } from "../auth/token-store";
import { ApiError } from "../lib/api";
import {
  getNotificationSettings,
  putNotificationType,
  putProjectMute,
  type NotificationSettings,
  type NotificationType,
} from "./api";
import { isMuted, saveChange, shouldApplyLoad, type SettingsChange } from "./settingsLogic";

export type SettingsStatus = "loading" | "ready" | "error";

/**
 * The person's notification settings (R24, R25): loaded each time the screen comes to the front, and each switch is
 * shown at once, saved, and put back with `saveFailed` set when the save does not go through.
 */
export function useNotificationSettings() {
  const { handleNotSignedIn } = useAuth();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [status, setStatus] = useState<SettingsStatus>("loading");
  const [saveFailed, setSaveFailed] = useState(false);
  const latest = useRef<NotificationSettings | null>(null);
  /** Counts switch changes, so a load that started before one does not overwrite it. */
  const changes = useRef(0);

  const show = useCallback((next: NotificationSettings) => {
    latest.current = next;
    setSettings(next);
  }, []);

  const load = useCallback(async () => {
    const startedAt = changes.current;
    try {
      const token = await getToken();
      if (!token) {
        if (latest.current === null) setStatus("error");
        return;
      }
      const loaded = await getNotificationSettings(token);
      if (!shouldApplyLoad(startedAt, changes.current)) return;
      show(loaded);
      setStatus("ready");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) void handleNotSignedIn();
      // A copy already on screen stays; with none, the screen says it could not load.
      if (latest.current === null) setStatus("error");
    }
  }, [handleNotSignedIn, show]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const change = useCallback(
    async (c: SettingsChange) => {
      if (latest.current === null) return;
      changes.current += 1;
      setSaveFailed(false);
      const { failed } = await saveChange(
        () => latest.current as NotificationSettings,
        show,
        async (applied) => {
          const token = await getToken();
          if (!token) throw new Error("not signed in");
          return applied.kind === "type"
            ? putNotificationType(token, applied.type, applied.enabled)
            : putProjectMute(token, applied.projectId, applied.muted);
        },
        c,
      );
      if (failed) setSaveFailed(true);
    },
    [show],
  );

  const setType = useCallback((type: NotificationType, enabled: boolean) => change({ kind: "type", type, enabled }), [change]);
  const setMuted = useCallback((projectId: string, muted: boolean) => change({ kind: "mute", projectId, muted }), [change]);

  return { settings, status, saveFailed, setType, setMuted, muted: (projectId: string) => isMuted(settings, projectId), reload: load };
}
