import type { ProjectsStatus } from "../projects/ProjectsProvider";

export type TaskView = "ready" | "loading" | "leave";

/**
 * What the Task details and Edit task screens do for the ids in their route: show the task,
 * wait for the lists to load, or leave for the Task list (the task, or its project, is gone: R21).
 */
export function taskView(args: {
  projectFound: boolean;
  projectsStatus: ProjectsStatus;
  tasksReady: boolean;
  taskFound: boolean;
}): TaskView {
  if (!args.projectFound) return args.projectsStatus === "loading" ? "loading" : "leave";
  if (!args.tasksReady) return "loading";
  return args.taskFound ? "ready" : "leave";
}
