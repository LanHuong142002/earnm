import { useIsFocused, useRouter } from "expo-router";
import { useEffect, type RefObject } from "react";

import { useProjects } from "../projects/ProjectsProvider";
import { projectView } from "../projects/routing";
import { useTasks } from "./TasksProvider";
import type { Label, ProjectRole, Task } from "./types";
import type { Project } from "../projects/api";

/**
 * What the label sheets and the Labels screen share: the project, my role in it, its labels and the
 * task when one is given. `gone` is true once the project, the task or the label is gone (deleted
 * elsewhere); the screen closes itself then.
 */
export function useLabelScreen(projectId: string, opts: { taskId?: string; labelId?: string } = {}) {
  const router = useRouter();
  const focused = useIsFocused();
  const { status, projects } = useProjects();
  const { ready, labelsFor, tasksFor } = useTasks();
  const project: Project | null = projects.find((p) => p.id === projectId) ?? null;
  const view = projectView(project, status, false);
  const labels: Label[] = ready ? labelsFor(projectId) : [];
  const task: Task | null = opts.taskId ? (tasksFor(projectId).find((x) => x.id === opts.taskId) ?? null) : null;
  const label: Label | null = opts.labelId ? (labels.find((x) => x.id === opts.labelId) ?? null) : null;
  const role: ProjectRole = project?.role ?? "member";

  const gone =
    view === "leave" ||
    (ready && project !== null && ((opts.taskId !== undefined && task === null) || (opts.labelId !== undefined && label === null)));

  return { project, view, ready, labels, task, label, role, gone, focused, router };
}

/** Closes the screen once, when what it shows is gone. `closing.current` holds it back while the screen closes itself. */
export function useCloseWhenGone(gone: boolean, focused: boolean, closing: RefObject<boolean> | null, close: () => void) {
  useEffect(() => {
    if (gone && focused && !closing?.current) close();
  }, [gone, focused, closing, close]);
}
