/** Queue entity names of the drafts code. Every one is registered with the shared queue. */
export const DRAFT_ENTITY = "draft";
/** A draft's status. Its own entity so a Done made while the lines wait is sent after them, and never folds into the create. */
export const DRAFT_STATUS_ENTITY = "draftStatus";
/** One recipe line of a draft. `entityId` is the line's id; `data.draftId` says which draft. */
export const DRAFT_LINE_ENTITY = "draftLine";
/** A draft photo waiting to be uploaded. `entityId` is the photo id. */
export const DRAFT_PHOTO_UPLOAD_ENTITY = "draftPhotoUpload";
/** A change to a draft photo the server already has (caption, delete). `entityId` is the photo id. */
export const DRAFT_PHOTO_ENTITY = "draftPhoto";
