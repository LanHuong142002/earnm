import type { Project } from "./api";
import type { ProjectsStatus } from "./ProjectsProvider";

/** What Home's top card shows. */
export type HomeCard = "project" | "loading" | "choose" | "invite";

export function homeCard(currentProject: Project | null, status: ProjectsStatus, projectCount: number): HomeCard {
  if (currentProject) return "project";
  // Wait for the first refresh only while there is nothing cached to show.
  if (status === "loading" && projectCount === 0) return "loading";
  // Projects exist but none is current (e.g. the current one was deleted): ask to choose one.
  if (projectCount > 0) return "choose";
  return "invite";
}

/**
 * What the Project and Edit screens do for the id in their route:
 * show it, wait for the first refresh, or leave for the Project list (id unknown or gone,
 * or, for Edit, the person isn't an Owner).
 */
export type ProjectView = "ready" | "loading" | "leave";

export function projectView(project: Project | null, status: ProjectsStatus, needsOwner: boolean): ProjectView {
  if (!project) return status === "loading" ? "loading" : "leave";
  if (needsOwner && project.role !== "owner") return "leave";
  return "ready";
}
