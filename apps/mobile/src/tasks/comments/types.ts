/** A comment exactly as the API returns it (contract: spec R1-R3). */
export type ServerComment = {
  id: string;
  taskId: string;
  /** Null once the author's account is gone. */
  author: { id: string; displayName: string } | null;
  text: string;
  /** True once the text was changed after posting. Flipping the reminder flag never sets it. */
  edited: boolean;
  /** "Nhắc kèm": the people involved in the task are reminded with this comment. */
  remindWith: boolean;
  createdAt: string;
};

/** `synced` came from the server; `waiting` is queued on the phone; `failed` was refused for good. */
export type CommentState = "synced" | "waiting" | "failed";

/** A comment as the screen shows it. */
export type Comment = ServerComment & { state: CommentState };

export type CommentOrder = "newest" | "oldest";

/**
 * What a queued comment change's `data` holds. Every change carries `projectId` and `taskId`.
 * - create: `text`, `remindWith`, and `authorId` / `authorName` (to show it before the server answers; never sent).
 * - update: only `text` and/or `remindWith`, each with its own time, so they merge per field.
 * - delete: nothing more.
 */
export type CommentChangeData = {
  projectId: string;
  taskId: string;
  text?: string;
  remindWith?: boolean;
  authorId?: string;
  authorName?: string;
};
