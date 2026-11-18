import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { getToken } from "../../auth/token-store";
import { useProjects } from "../../projects/ProjectsProvider";
import { asyncStorageStore } from "../../sync/asyncStorageStore";
import type { DueLanguage } from "../dueDate";
import { useTasks } from "../TasksProvider";
import { applySchedule, registerPushToken } from "./notifications";
import { tapDestination, tapTarget } from "./notificationLogic";
import { planNotifications } from "./scheduler";
import { onScheduleSignal } from "./scheduleSignal";
import { scheduleSource } from "./scheduleSource";
import { loadReminderCache, subscribeReminders } from "./store";

/**
 * Keeps this phone's notifications in line with the saved reminders (R18) and opens the task a tapped notification is
 * about (R17). It renders nothing; the decisions are in the tested modules it calls.
 */
export function NotificationGlue() {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { identity } = useAuth();
  const { projects, sync } = useProjects();
  const { ready, tasksFor, refresh } = useTasks();
  const meId = identity?.id ?? null;
  const [tick, setTick] = useState(0);
  const bump = useCallback(() => setTick((n) => n + 1), []);
  const projectIds = projects.map((p) => p.id).join("|");

  // Plan again after every refresh (the reminder cache is written), every local change (the queue is flushed),
  // when permission may have changed, and when the app comes back to the front.
  useEffect(() => {
    const offCache = subscribeReminders(bump);
    const offFlush = sync.onFlushed(bump);
    const offSignal = onScheduleSignal(bump);
    const app = AppState.addEventListener("change", (state) => {
      if (state === "active") bump();
    });
    return () => {
      offCache();
      offFlush();
      offSignal();
      app.remove();
    };
  }, [bump, sync]);

  useEffect(() => {
    if (meId === null || !ready) return;
    let stale = false;
    void (async () => {
      const [cache, waiting] = await Promise.all([loadReminderCache(asyncStorageStore, meId), sync.queue.waiting()]);
      if (stale) return;
      const source = scheduleSource({ cache, waiting, projectIds: projects.map((p) => p.id), tasksFor });
      const lang: DueLanguage = i18n.language === "vi" ? "vi" : "en";
      const names = Object.fromEntries(projects.map((p) => [p.id, p.name]));
      await applySchedule(planNotifications({ ...source, projectNames: names, meId, now: new Date(), lang, t }));
      const token = await getToken();
      if (token && !stale) await registerPushToken(token);
    })().catch(() => undefined);
    return () => {
      stale = true;
    };
    // `projectIds` stands for the project list: planning again only when the set changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meId, ready, tick, tasksFor, projectIds, i18n.language, sync.queue, t]);

  // A tap, including the one that launched the app, once the signed-in copy is loaded.
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  const latestTasks = useRef(tasksFor);
  useEffect(() => {
    latestTasks.current = tasksFor;
  }, [tasksFor]);
  useEffect(() => {
    if (!response || meId === null || !ready) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = `${response.notification.request.identifier}|${response.notification.date}`;
    if (handled.current === key) return;
    handled.current = key;
    const target = tapTarget(response.notification.request.content.data);
    if (target === null) return;
    const has = () => latestTasks.current(target.projectId).some((x) => x.id === target.taskId);
    void (async () => {
      if (!has()) {
        await refresh(target.projectId).catch(() => undefined);
        // Let the refreshed list reach this component before looking again.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      router.push(tapDestination(target, has()));
    })();
  }, [response, meId, ready, refresh, router]);

  return null;
}
