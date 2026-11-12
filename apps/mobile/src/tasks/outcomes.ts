import type { ApiError } from "../lib/api";
import type { Change, ChangeKind } from "../sync/queue";
import { reasonFor, type RejectedReason } from "../projects/outcomes";
import { withApplied } from "./optimistic";
import { applyTaskOverlay } from "./store";
import { taskProjectId } from "./sync";
import type { Task } from "./types";

export type { RejectedReason };
export type TaskRejectedNotice = { kind: ChangeKind; taskTitle: string | null; reason: RejectedReason };

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
  forbidden: "errors.forbidden",
  not_found: "errors.not_found",
  conflict: "errors.id_conflict",
  invalid: "errors.validation_failed",
};

/** i18n keys for a refused-change notice; a refused create says it couldn't be created. */
export function noticeKeys(notice: TaskRejectedNotice): { headline: string; reason: string } {
  const named = notice.taskTitle !== null;
  if (notice.kind === "create") {
    return {
      headline: named ? "tasks.rejectedCreate" : "tasks.rejectedCreateNoTitle",
      reason: notice.reason === "forbidden" || notice.reason === "not_found" ? "errors.create_failed" : REASON_KEY[notice.reason],
    };
  }
  return { headline: named ? "tasks.rejected" : "tasks.rejectedNoTitle", reason: REASON_KEY[notice.reason] };
}
