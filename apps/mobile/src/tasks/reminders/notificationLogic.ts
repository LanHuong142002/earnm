/** Pure decisions behind the notification glue (spec R14-R17, R25); the glue itself only calls the system. */

export type PermissionState = "granted" | "denied" | "undetermined";

/** The system's answer for notification permission as one of three states. */
export function permissionFromResponse(response: { status: string }): PermissionState {
  return response.status === "granted" ? "granted" : response.status === "denied" ? "denied" : "undetermined";
}

/** The explanation sheet is shown after a save only while iOS has never been asked (R15). */
export function shouldAskAfterSave(permission: PermissionState): boolean {
  return permission === "undetermined";
}

/** The "notifications are off" notice (R25): permission refused and at least one reminder this phone would miss. */
export function showPermissionNotice(permission: PermissionState | null, reminderCount: number): boolean {
  return permission === "denied" && reminderCount > 0;
}

/** The EAS project id from the app config's `extra`, or null: without it the phone registers no push token (R14). */
export function easProjectId(extra: unknown): string | null {
  const eas = (extra as { eas?: { projectId?: unknown } } | undefined | null)?.eas;
  return typeof eas?.projectId === "string" && eas.projectId !== "" ? eas.projectId : null;
}

export type TapTarget =
  | { type: "task"; projectId: string; taskId: string }
  | { type: "idea"; projectId: string; ideaId: string }
  | { type: "members"; projectId: string }
  | { type: "project"; projectId: string };

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";

/**
 * Where a notification opens, from its `data`: a reminder (`projectId` and `taskId`) or an activity push
 * (`kind: "activity"` with a `target`). Null when the data is not one of ours or is malformed.
 */
export function tapTarget(data: unknown): TapTarget | null {
  const d = data as { kind?: unknown; projectId?: unknown; taskId?: unknown; target?: unknown } | null | undefined;
  if (!nonEmpty(d?.projectId)) return null;
  const projectId = d.projectId;
  if (d.kind === "activity") {
    const t = d.target as { type?: unknown; taskId?: unknown; ideaId?: unknown } | null | undefined;
    if (t?.type === "task") return nonEmpty(t.taskId) ? { type: "task", projectId, taskId: t.taskId } : null;
    if (t?.type === "idea") return nonEmpty(t.ideaId) ? { type: "idea", projectId, ideaId: t.ideaId } : null;
    if (t?.type === "members") return { type: "members", projectId };
    if (t?.type === "project") return { type: "project", projectId };
    return null;
  }
  return nonEmpty(d.taskId) ? { type: "task", projectId, taskId: d.taskId } : null;
}

/** The activity event ids a push carries (R31): an array of strings, else empty. */
export function activityEventIds(data: unknown): string[] {
  const ids = (data as { kind?: unknown; eventIds?: unknown } | null | undefined)?.eventIds;
  return Array.isArray(ids) && ids.every((x) => typeof x === "string") ? (ids as string[]) : [];
}

export type TapLookups = {
  isMember: (projectId: string) => boolean;
  hasTask: (projectId: string, taskId: string) => boolean;
  hasIdea: (projectId: string, ideaId: string) => boolean;
};

/** Whether what a tap points at is still there locally: the task or idea itself, or the project for its own screens. */
export function tapFound(target: TapTarget, lookups: TapLookups): boolean {
  switch (target.type) {
    case "task":
      return lookups.hasTask(target.projectId, target.taskId);
    case "idea":
      return lookups.hasIdea(target.projectId, target.ideaId);
    default:
      return lookups.isMember(target.projectId);
  }
}

export type TapDestination =
  | { pathname: "/projects/[id]/tasks/[taskId]"; params: { id: string; taskId: string } }
  | { pathname: "/projects/[id]/ideas/[ideaId]"; params: { id: string; ideaId: string } }
  | { pathname: "/projects/[id]/members"; params: { id: string } }
  | { pathname: "/projects/[id]"; params: { id: string } }
  | { pathname: "/projects" };

/** Where a tap goes: the target, or the project list with no error when it is gone or the person is not a member (R17, R24). */
export function tapDestination(target: TapTarget, found: boolean): TapDestination {
  if (!found) return { pathname: "/projects" };
  switch (target.type) {
    case "task":
      return { pathname: "/projects/[id]/tasks/[taskId]", params: { id: target.projectId, taskId: target.taskId } };
    case "idea":
      return { pathname: "/projects/[id]/ideas/[ideaId]", params: { id: target.projectId, ideaId: target.ideaId } };
    case "members":
      return { pathname: "/projects/[id]/members", params: { id: target.projectId } };
    case "project":
      return { pathname: "/projects/[id]", params: { id: target.projectId } };
  }
}
