import type { Change, EntityHandlers, NewChange, Queue } from "../sync/queue";
import { createIdea, deleteIdea, patchIdea, putVote, type IdeaFieldPatch } from "./api";
import { IDEA_ENTITY, IDEA_LABELS_ENTITY, IDEA_VOTE_ENTITY } from "./entities";
import type { IdeaStatus, Vote } from "./types";

type Deps = {
  createIdea: typeof createIdea;
  patchIdea: typeof patchIdea;
  deleteIdea: typeof deleteIdea;
  putVote: typeof putVote;
};

const realDeps: Deps = { createIdea, patchIdea, deleteIdea, putVote };

const timeOf = (change: Change, field: string) => change.fieldTimes[field] ?? change.createdAt;
const projectOf = (change: Change) => String(change.data.projectId);

/**
 * Queued idea changes. `data` always carries `projectId` (the URL needs it).
 * - `idea` create: `title`, `description` and who made it (`authorId` / `authorName`, to show it before the server answers; never sent).
 *   An edit made while the create waits folds into it, so a create may also carry `status`.
 * - `idea` update: only the changed ones of `title`, `description`, `status`, each with its own time, so changes made
 *   on two phones merge per field and two quick edits of one idea leave one request.
 * - `ideaLabels`: `labels`, the whole set of label ids. Its own change, never part of the create or an update: the
 *   labels may name a label this phone created and has not sent yet, so the set must go after that label.
 * - `ideaVote`: `value` (-1, 0 or 1). One per idea: a second vote before the first is sent replaces it.
 */
export function ideaCreateChange(input: {
  id: string;
  projectId: string;
  title: string;
  description: string;
  author: { id: string; displayName: string } | null;
  now: Date;
}): NewChange {
  const at = input.now.toISOString();
  const data: Record<string, unknown> = { projectId: input.projectId, title: input.title, description: input.description };
  if (input.author) {
    data.authorId = input.author.id;
    data.authorName = input.author.displayName;
  }
  return { entity: IDEA_ENTITY, entityId: input.id, kind: "create", data, fieldTimes: { title: at, description: at } };
}

export type IdeaFieldChanges = { title?: string; description?: string; status?: IdeaStatus };

export function ideaUpdateChange(input: { id: string; projectId: string; fields: IdeaFieldChanges; now: Date }): NewChange {
  const at = input.now.toISOString();
  const data: Record<string, unknown> = { projectId: input.projectId };
  const fieldTimes: Record<string, string> = {};
  for (const field of ["title", "description", "status"] as const) {
    const value = input.fields[field];
    if (value === undefined) continue;
    data[field] = value;
    fieldTimes[field] = at;
  }
  return { entity: IDEA_ENTITY, entityId: input.id, kind: "update", data, fieldTimes };
}

export function ideaLabelsChange(input: { id: string; projectId: string; labelIds: string[]; now: Date }): NewChange {
  const at = input.now.toISOString();
  return {
    entity: IDEA_LABELS_ENTITY,
    entityId: input.id,
    kind: "update",
    data: { projectId: input.projectId, labels: input.labelIds },
    fieldTimes: { projectId: at, labels: at },
  };
}

export function ideaVoteChange(input: { id: string; projectId: string; value: Vote; now: Date }): NewChange {
  const at = input.now.toISOString();
  return {
    entity: IDEA_VOTE_ENTITY,
    entityId: input.id,
    kind: "update",
    data: { projectId: input.projectId, value: input.value },
    fieldTimes: { projectId: at, value: at },
  };
}

export function ideaDeleteChange(input: { id: string; projectId: string }): NewChange {
  return { entity: IDEA_ENTITY, entityId: input.id, kind: "delete", data: { projectId: input.projectId }, fieldTimes: {} };
}

const noop = () => Promise.resolve(undefined);

/** Registers ideas, an idea's label set and an idea's vote with the shared queue; `handlers` receive every result. */
export function registerIdeaEntities(queue: Queue, handlers: EntityHandlers, deps: Deps = realDeps): void {
  const sendLabels = (change: Change, token: string) =>
    deps.patchIdea(token, projectOf(change), change.entityId, {
      labels: { value: (change.data.labels as string[] | undefined) ?? [], editedAt: timeOf(change, "labels") },
    });
  queue.registerEntity(IDEA_LABELS_ENTITY, { create: sendLabels, update: sendLabels, delete: noop }, handlers);

  const sendVote = (change: Change, token: string) => deps.putVote(token, projectOf(change), change.entityId, (change.data.value as Vote | undefined) ?? 0);
  queue.registerEntity(IDEA_VOTE_ENTITY, { create: sendVote, update: sendVote, delete: noop }, handlers);

  queue.registerEntity(
    IDEA_ENTITY,
    {
      create: async (change, token) => {
        const { data } = change;
        const projectId = projectOf(change);
        const created = await deps.createIdea(token, projectId, {
          id: change.entityId,
          title: String(data.title ?? ""),
          description: String(data.description ?? ""),
        });
        // A status chosen while the create was still waiting goes in a second request: the create has no status.
        if (typeof data.status !== "string" || data.status === "new") return created;
        return deps.patchIdea(token, projectId, change.entityId, {
          status: { value: data.status as IdeaStatus, editedAt: timeOf(change, "status") },
        });
      },
      update: (change, token) => {
        const fields: IdeaFieldPatch = {};
        const { data } = change;
        if (typeof data.title === "string") fields.title = { value: data.title, editedAt: timeOf(change, "title") };
        if (typeof data.description === "string") fields.description = { value: data.description, editedAt: timeOf(change, "description") };
        if (typeof data.status === "string") fields.status = { value: data.status as IdeaStatus, editedAt: timeOf(change, "status") };
        return deps.patchIdea(token, projectOf(change), change.entityId, fields);
      },
      delete: (change, token) => deps.deleteIdea(token, projectOf(change), change.entityId),
    },
    handlers,
  );
}
