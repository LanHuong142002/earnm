import type { ApiError } from "../lib/api";
import type { Change, ChangeKind } from "../sync/queue";
import type { Project } from "./api";
import { withApplied } from "./optimistic";
import { applyOverlay } from "./store";

/** Why the server refused a change for good; the screen picks the wording. */
export type RejectedReason = "forbidden" | "not_found" | "conflict" | "invalid";
export type RejectedNotice = { kind: ChangeKind; projectName: string | null; reason: RejectedReason };

export function reasonFor(error: ApiError): RejectedReason {
  if (error.status === 403) return "forbidden";
  if (error.status === 404) return "not_found";
  if (error.status === 409) return "conflict";
  return "invalid";
}

/** The local list after the server accepted `change`, with the changes still waiting replayed on top. */
export function onApplied(list: Project[], change: Change, response: Project | undefined, waiting: Change[]): Project[] {
  return applyOverlay(withApplied(list, change, response), waiting);
}

export type RejectedOutcome = {
  list: Project[];
  notice: RejectedNotice;
  /** The server's version must be fetched to replace the local edit (not needed once the project is gone). */
  needsRefresh: boolean;
};

/**
 * What happens when the server refuses `change` for good. A 404 means the project is gone, so it
 * leaves the local list. Anything else keeps the list until the refresh restores the server's version.
 */
export function onRejected(list: Project[], change: Change, error: ApiError, waiting: Change[]): RejectedOutcome {
  // Name the project as the person knows it (before this rejection is applied), not by a rename that was refused.
  const known = list.find((p) => p.id === change.entityId)?.name;
  const name = known ?? (typeof change.data.name === "string" ? change.data.name : null);
  const notice: RejectedNotice = { kind: change.kind, projectName: name, reason: reasonFor(error) };
  if (error.status === 404) {
    return { list: applyOverlay(list.filter((p) => p.id !== change.entityId), waiting), notice, needsRefresh: true };
  }
  return { list, notice, needsRefresh: true };
}

/** The local list after a refresh: the server's projects with the waiting changes on top. */
export function restoreFromServer(server: Project[], waiting: Change[]): Project[] {
  return applyOverlay(server, waiting);
}

const REASON_KEY: Record<RejectedReason, string> = {
  forbidden: "errors.forbidden",
  not_found: "errors.not_found",
  conflict: "errors.id_conflict",
  invalid: "errors.validation_failed",
};

/** i18n keys for a rejected-change notice: a refused create says it couldn't be created, not that the project is gone. */
export function noticeKeys(notice: RejectedNotice): { headline: string; reason: string } {
  const named = notice.projectName !== null;
  if (notice.kind === "create") {
    return {
      headline: named ? "projects.rejectedCreate" : "projects.rejectedCreateNoName",
      reason: notice.reason === "forbidden" || notice.reason === "not_found" ? "errors.create_failed" : REASON_KEY[notice.reason],
    };
  }
  return {
    headline: named ? "projects.rejected" : "projects.rejectedNoName",
    reason: REASON_KEY[notice.reason],
  };
}
