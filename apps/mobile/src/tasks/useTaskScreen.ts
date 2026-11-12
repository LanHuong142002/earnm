import { useIsFocused, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../auth/AuthProvider";
import { useProjects } from "../projects/ProjectsProvider";
import { canDeleteTask } from "./permissions";
import { useTasks } from "./TasksProvider";
import { taskView } from "./taskRouting";
import type { Task } from "./types";
import type { Project } from "../projects/api";

/** What Task details and Edit task share: the task from the route, leaving when it is gone, and delete. */
export function useTaskScreen(projectId: string, taskId: string) {
  const { t } = useTranslation();
  const router = useRouter();
  const focused = useIsFocused();
  const { identity } = useAuth();
  const { status, projects } = useProjects();
  const { ready, tasksFor, remove } = useTasks();
  const [deleting, setDeleting] = useState(false);

  const project: Project | null = projects.find((p) => p.id === projectId) ?? null;
  const task: Task | null = tasksFor(projectId).find((x) => x.id === taskId) ?? null;
  const view = taskView({
    projectFound: project !== null,
    projectsStatus: status,
    tasksReady: ready,
    taskFound: task !== null,
  });

  const goToTaskList = () => router.dismissTo({ pathname: "/projects/[id]/tasks", params: { id: projectId } });

  // Gone (deleted elsewhere, or refused as not found): to the Task list, which shows the notice.
  // Not while deleting here, which navigates itself.
  useEffect(() => {
    if (view === "leave" && focused && !deleting) router.dismissTo({ pathname: "/projects/[id]/tasks", params: { id: projectId } });
  }, [view, focused, deleting, router, projectId]);

  const canDelete = task !== null && project !== null && identity !== null && canDeleteTask(task, identity.id, project.role);

  function confirmDelete() {
    if (!task) return;
    Alert.alert(t("tasks.deleteTitle", { title: task.title }), t("tasks.deleteMessage", { title: task.title }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("tasks.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          void (async () => {
            try {
              await remove(projectId, task.id);
              // To the list; nothing of the deleted task stays in the history.
              goToTaskList();
            } catch {
              setDeleting(false);
              Alert.alert(t("errors.generic"));
            }
          })();
        },
      },
    ]);
  }

  return { project, task, view, deleting, canDelete, confirmDelete };
}
