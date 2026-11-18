/** The queue entity names the ideas code registers with the shared queue. */
/** An idea: create, and update of its title, description and status. `entityId` is the idea id (chosen by the phone). */
export const IDEA_ENTITY = "idea";
/** An idea's whole label set, sent as its own change (`entityId` is the idea id) so it can wait behind a label create. */
export const IDEA_LABELS_ENTITY = "ideaLabels";
/** The viewer's vote on an idea (`entityId` is the idea id). Only the last vote per idea is sent. */
export const IDEA_VOTE_ENTITY = "ideaVote";
/** A comment on an idea. `entityId` is the comment id. */
export const IDEA_COMMENT_ENTITY = "ideaComment";
/** An idea photo waiting to be uploaded. `entityId` is the photo id. */
export const IDEA_PHOTO_UPLOAD_ENTITY = "ideaPhotoUpload";
/** A change to an idea photo the server already has (caption, delete). `entityId` is the photo id. */
export const IDEA_PHOTO_ENTITY = "ideaPhoto";
