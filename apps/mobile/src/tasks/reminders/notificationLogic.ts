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

export type TapTarget = { projectId: string; taskId: string };

/** The project and task a notification was scheduled for (its `data`), or null when it is not one of ours. */
export function tapTarget(data: unknown): TapTarget | null {
  const d = data as { projectId?: unknown; taskId?: unknown } | null | undefined;
  if (typeof d?.projectId !== "string" || d.projectId === "" || typeof d.taskId !== "string" || d.taskId === "") return null;
  return { projectId: d.projectId, taskId: d.taskId };
}

export type TapDestination =
  | { pathname: "/projects/[id]/tasks/[taskId]"; params: { id: string; taskId: string } }
  | { pathname: "/projects" };

/** Where a tap goes: the task, or the project list with no error when the task or its project is gone (R17). */
export function tapDestination(target: TapTarget, taskFound: boolean): TapDestination {
  return taskFound
    ? { pathname: "/projects/[id]/tasks/[taskId]", params: { id: target.projectId, taskId: target.taskId } }
    : { pathname: "/projects" };
}
