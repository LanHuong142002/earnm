/** Queue entity names of the drafts code. Every one is registered with the shared queue. */
export const DRAFT_ENTITY = "draft";
/** A draft's status. Its own entity so a Done made while the lines wait is sent after them, and never folds into the create. */
export const DRAFT_STATUS_ENTITY = "draftStatus";
/** One recipe line of a draft. `entityId` is the line's id; `data.draftId` says which draft. */
export const DRAFT_LINE_ENTITY = "draftLine";
