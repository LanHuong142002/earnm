/** The entity names the tasks code registers with the shared queue. Kept apart so helpers can use them without importing the senders. */
export const TASK_ENTITY = "task";
/** A task's whole label set, sent as its own change (`entityId` is the task id) so it can wait behind a label create. */
export const TASK_LABELS_ENTITY = "taskLabels";
export const LABEL_ENTITY = "label";
export const CHECKLIST_ENTITY = "checklist";
export const ITEM_ENTITY = "checklistItem";
