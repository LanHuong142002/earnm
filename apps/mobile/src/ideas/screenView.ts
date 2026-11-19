import type { ProfileStatus } from "../auth/AuthProvider";
import type { ProjectsStatus } from "../projects/ProjectsProvider";
import type { ProjectRole } from "../tasks/types";
import { canEditIdea } from "./permissions";
import type { Idea, IdeaStatus, Vote } from "./types";

export type IdeaScreenView = "ready" | "loading" | "leave";

/**
 * What the idea screens do for the ids in their route: show the idea, wait for the lists to load, or leave for
 * the ideas list (the idea, or its project, is gone).
 */
export function ideaView(args: {
  projectFound: boolean;
  projectsStatus: ProjectsStatus;
  ideasReady: boolean;
  ideaFound: boolean;
}): IdeaScreenView {
  if (!args.projectFound) return args.projectsStatus === "loading" ? "loading" : "leave";
  if (!args.ideasReady) return "loading";
  return args.ideaFound ? "ready" : "leave";
}

/** Same rule as the "Offline" line: the projects or the profile could not be reached. */
export const isOnline = (projectsStatus: ProjectsStatus, profileStatus: ProfileStatus): boolean =>
  projectsStatus !== "offline" && profileStatus !== "offline";

/**
 * Whether "Sửa" and "Xoá ý tưởng" show. `me` is the stored identity, which counts while the profile request is
 * pending, so the buttons never wait on the network. Unknown person or role: hidden.
 */
export function canEditAs(idea: Pick<Idea, "author">, me: { id: string } | null, role: ProjectRole | null): boolean {
  return me !== null && role !== null && canEditIdea(idea, me.id, role);
}

/** Which of the two vote buttons is highlighted. */
export const votePressedState = (myVote: Vote): { up: boolean; down: boolean } => ({ up: myVote === 1, down: myVote === -1 });

/** The viewer's vote as a word, for the screen reader's label. */
export const voteChoice = (myVote: Vote): "up" | "down" | "none" => (myVote === 1 ? "up" : myVote === -1 ? "down" : "none");

/** How a status pill is coloured: the accent tint, the blue and green label pairs, or the quiet field grey. */
export type IdeaStatusTone = "accent" | "blue" | "green" | "muted";
export const ideaStatusTone = (status: IdeaStatus): IdeaStatusTone =>
  status === "new" ? "accent" : status === "considering" ? "blue" : status === "accepted" ? "green" : "muted";

/** The local calendar day of an ISO time as `YYYY-M-D` (what `formatDue` reads), or null when it is not a time. */
export function ideaDayOf(iso: string): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`;
}
