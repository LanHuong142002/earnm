import { TASK_STATUSES, type TaskStatus } from "./types";

/**
 * The statuses an Android Alert offers: all but the current one. Android shows at most three
 * buttons, so two statuses plus Cancel always fit (a fourth would be dropped).
 */
export function androidStatusChoices(current: TaskStatus): TaskStatus[] {
  return TASK_STATUSES.filter((s) => s !== current);
}
