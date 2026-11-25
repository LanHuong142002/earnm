import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";

import { useIdeas } from "../ideas/IdeasProvider";
import { useProjects } from "../projects/ProjectsProvider";
import { useTapOnce } from "../projects/useProjectNav";
import { tapDestination, tapFound } from "../tasks/reminders/notificationLogic";
import { useTasks } from "../tasks/TasksProvider";
import { useActivity } from "./ActivityProvider";
import type { ActivityItem } from "./api";
import { rowTarget } from "./format";

/**
 * Opens what an Activity row is about, marking it read first (R30, R31). It looks the target up the way a tapped push
 * does: a task or idea not on the phone yet is fetched once, and what is gone or left sends the person to the Project
 * list with no error (R17).
 */
export function useOpenActivity(): (item: ActivityItem) => void {
  const router = useRouter();
  const once = useTapOnce();
  const { markEventsRead } = useActivity();
  const { projects } = useProjects();
  const { tasksFor, refresh } = useTasks();
  const { ideasFor, refresh: refreshIdeas } = useIdeas();

  const latest = useRef({ projects, tasksFor, ideasFor });
  useEffect(() => {
    latest.current = { projects, tasksFor, ideasFor };
  }, [projects, tasksFor, ideasFor]);

  return useCallback(
    (item: ActivityItem) =>
      once(() => {
        if (!item.read) markEventsRead([item.id]);
        const target = rowTarget(item);
        const has = () =>
          tapFound(target, {
            isMember: (projectId) => latest.current.projects.some((p) => p.id === projectId),
            hasTask: (projectId, taskId) => latest.current.tasksFor(projectId).some((x) => x.id === taskId),
            hasIdea: (projectId, ideaId) => latest.current.ideasFor(projectId).some((x) => x.id === ideaId),
          });
        void (async () => {
          if (!has() && (target.type === "task" || target.type === "idea")) {
            await (target.type === "task" ? refresh(target.projectId) : refreshIdeas(target.projectId)).catch(() => undefined);
            // Let the refreshed list reach this component before looking again.
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          router.push(tapDestination(target, has()));
        })();
      }),
    [once, markEventsRead, refresh, refreshIdeas, router],
  );
}
