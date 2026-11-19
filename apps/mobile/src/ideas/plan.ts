import { cleanMultiLine, cleanSingleLine } from "../lib/text";
import type { NewChange } from "../sync/queue";
import { toggleVote } from "./overlay";
import { ideaCreateChange, ideaDeleteChange, ideaLabelsChange, ideaUpdateChange, ideaVoteChange, type IdeaFieldChanges } from "./sync";
import type { Idea, IdeaStatus, Vote } from "./types";

export const TITLE_MAX = 120;
export const DESCRIPTION_MAX = 2000;
export const LABELS_MAX = 10;

export type IdeaInput = { title: string; description: string; labelIds: string[] };
export type IdeaInputErrors = { title?: "required" | "too_long"; description?: "too_long"; labels?: "too_many" };

/** What the form may be saved with, cleaned the way the server reads it, and what is wrong with it. */
export function validateIdeaInput(input: IdeaInput): { value: IdeaInput; errors: IdeaInputErrors } {
  const value: IdeaInput = {
    title: cleanSingleLine(input.title),
    description: cleanMultiLine(input.description),
    labelIds: [...new Set(input.labelIds)],
  };
  const errors: IdeaInputErrors = {};
  if (value.title === "") errors.title = "required";
  else if (Array.from(value.title).length > TITLE_MAX) errors.title = "too_long";
  if (Array.from(value.description).length > DESCRIPTION_MAX) errors.description = "too_long";
  if (value.labelIds.length > LABELS_MAX) errors.labels = "too_many";
  return { value, errors };
}

/** Changes to queue, in this order. A plan has several when an edit touches the labels too: the label set is its own change. */
export type IdeaPlan = { ok: true; changes: NewChange[] } | { ok: false; errors: IdeaInputErrors };

export function planIdeaCreate(input: {
  id: string;
  projectId: string;
  input: IdeaInput;
  author: { id: string; displayName: string } | null;
  now: Date;
}): IdeaPlan {
  const { value, errors } = validateIdeaInput(input.input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const changes = [
    ideaCreateChange({ id: input.id, projectId: input.projectId, title: value.title, description: value.description, author: input.author, now: input.now }),
  ];
  // The label set goes after the create and as its own change; it may name a label that is still waiting to be created.
  if (value.labelIds.length > 0) changes.push(ideaLabelsChange({ id: input.id, projectId: input.projectId, labelIds: value.labelIds, now: input.now }));
  return { ok: true, changes };
}

export type IdeaEdit = { title?: string; description?: string; status?: IdeaStatus; labelIds?: string[] };

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Only what differs from `current` is queued. An edit that changes nothing has no changes. */
export function planIdeaUpdate(current: Idea, edit: IdeaEdit, now: Date): IdeaPlan {
  const errors: IdeaInputErrors = {};
  const fields: IdeaFieldChanges = {};
  if (edit.title !== undefined) {
    const { value, errors: e } = validateIdeaInput({ title: edit.title, description: "", labelIds: [] });
    if (e.title) errors.title = e.title;
    else if (value.title !== current.title) fields.title = value.title;
  }
  if (edit.description !== undefined) {
    const { value, errors: e } = validateIdeaInput({ title: "x", description: edit.description, labelIds: [] });
    if (e.description) errors.description = e.description;
    else if (value.description !== current.description) fields.description = value.description;
  }
  if (edit.status !== undefined && edit.status !== current.status) fields.status = edit.status;
  let labelIds: string[] | null = null;
  if (edit.labelIds !== undefined) {
    const ids = [...new Set(edit.labelIds)];
    if (ids.length > LABELS_MAX) errors.labels = "too_many";
    else if (!sameSet(ids, current.labelIds)) labelIds = ids;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const changes: NewChange[] = [];
  if (Object.keys(fields).length > 0) changes.push(ideaUpdateChange({ id: current.id, projectId: current.projectId, fields, now }));
  if (labelIds !== null) changes.push(ideaLabelsChange({ id: current.id, projectId: current.projectId, labelIds, now }));
  return { ok: true, changes };
}

/** The vote change a press makes. `current` is the idea as shown (waiting votes included): pressing your own vote again takes it back. */
export function planVote(current: Pick<Idea, "id" | "projectId" | "myVote">, pressed: 1 | -1, now: Date): NewChange {
  const value: Vote = toggleVote(current.myVote, pressed);
  return ideaVoteChange({ id: current.id, projectId: current.projectId, value, now });
}

export const planIdeaDelete = (current: Pick<Idea, "id" | "projectId">): NewChange => ideaDeleteChange({ id: current.id, projectId: current.projectId });
