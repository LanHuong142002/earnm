import type { ApiError } from "../lib/api";
import type { Change, ChangeKind } from "../sync/queue";
import { withApplied } from "./optimistic";
import { applyTaskOverlay } from "./store";
import { taskProjectId } from "./sync";
import type { Task } from "./types";

/** Why the server refused a task change for good; the notice picks task wording from it. */
export type RejectedReason = "forbidden" | "not_found" | "conflict" | "invalid" | "limit" | "generic";
export type TaskRejectedNotice = { kind: ChangeKind; taskTitle: string | null; reason: RejectedReason };

/** The refusal's error code decides first, then its status; anything else is "generic". */
export function reasonFor(error: ApiError): RejectedReason {
  switch (error.code) {
    case "task_limit_reached":
      return "limit";
    case "id_conflict":
      return "conflict";
    case "validation_failed":
      return "invalid";
    case "not_found":
      return "not_found";
    case "forbidden":
      return "forbidden";
  }
  if (error.status === 403) return "forbidden";
  if (error.status === 404) return "not_found";
  if (error.status === 409) return "conflict";
  return "generic";
}

/** The cached list after the server accepted `change`, with the changes still waiting replayed on top. */
export function onApplied(list: Task[], change: Change, response: Task | undefined, waiting: Change[]): Task[] {
  return applyTaskOverlay(taskProjectId(change), withApplied(list, change, response), waiting);
}

export type RejectedOutcome = {
  list: Task[];
  notice: TaskRejectedNotice;
  /** The project to fetch again so the server's version replaces the local edit. Always set. */
  refreshProjectId: string;
};

/**
 * What happens when the server refuses `change` for good. A 404 means the task is gone, so it leaves
 * the list. Anything else keeps the list until the refresh restores the server's version. In every
 * case the project is marked for a refresh (a 404 may mean the whole project is gone, which only the
 * refresh can tell).
 */
export function onRejected(list: Task[], change: Change, error: ApiError, waiting: Change[]): RejectedOutcome {
  const known = list.find((t) => t.id === change.entityId)?.title;
  const taskTitle = known ?? (typeof change.data.title === "string" ? change.data.title : null);
  const notice: TaskRejectedNotice = { kind: change.kind, taskTitle, reason: reasonFor(error) };
  const projectId = taskProjectId(change);
  const next = error.status === 404 ? applyTaskOverlay(projectId, list.filter((t) => t.id !== change.entityId), waiting) : list;
  return { list: next, notice, refreshProjectId: projectId };
}

const REASON_KEY: Record<RejectedReason, string> = {
  forbidden: "tasks.reasons.forbidden",
  not_found: "tasks.reasons.notFound",
  conflict: "tasks.reasons.conflict",
  invalid: "tasks.reasons.invalid",
  limit: "tasks.reasons.limit",
  generic: "tasks.reasons.generic",
};

/** i18n keys for a refused-change notice. Only the creator or an Owner can delete, so a refused delete says that. */
export function noticeKeys(notice: TaskRejectedNotice): { headline: string; reason: string } {
  const named = notice.taskTitle !== null;
  let reason = REASON_KEY[notice.reason];
  if (notice.kind === "delete" && notice.reason === "forbidden") reason = "tasks.reasons.forbiddenDelete";
  // A refused create answered 404 means the project is gone; there is no task yet to have "disappeared".
  if (notice.kind === "create" && notice.reason === "not_found") reason = "tasks.reasons.projectGone";
  if (notice.kind === "create") return { headline: named ? "tasks.rejectedCreate" : "tasks.rejectedCreateNoTitle", reason };
  return { headline: named ? "tasks.rejected" : "tasks.rejectedNoTitle", reason };
}
