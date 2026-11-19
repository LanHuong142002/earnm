import { LABELS_MAX, type IdeaEdit, type IdeaInput, type IdeaInputErrors } from "./plan";
import type { Idea } from "./types";

/** What the New idea and Edit idea screens edit (spec R20). Photos are not here: they belong to a saved idea. */
export type IdeaFormValues = { title: string; description: string; labelIds: string[] };

export const emptyIdeaForm = (): IdeaFormValues => ({ title: "", description: "", labelIds: [] });

export const ideaFormFromIdea = (idea: Pick<Idea, "title" | "description" | "labelIds">): IdeaFormValues => ({
  title: idea.title,
  description: idea.description,
  labelIds: [...idea.labelIds],
});

export const inputFromIdeaForm = (form: IdeaFormValues): IdeaInput => ({
  title: form.title,
  description: form.description,
  labelIds: [...form.labelIds],
});

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Only the fields the person changed, so an unchanged field never overwrites a newer edit from someone else. */
export function editFromIdeaForm(opened: IdeaFormValues, form: IdeaFormValues): IdeaEdit {
  const edit: IdeaEdit = {};
  if (form.title !== opened.title) edit.title = form.title;
  if (form.description !== opened.description) edit.description = form.description;
  if (!sameSet(form.labelIds, opened.labelIds)) edit.labelIds = [...form.labelIds];
  return edit;
}

/** A tap on a label: remove it, or add it unless the idea already has the most (10). */
export function toggleIdeaLabel(current: readonly string[], id: string): { ids: string[]; limit: boolean } {
  if (current.includes(id)) return { ids: current.filter((x) => x !== id), limit: false };
  if (current.length >= LABELS_MAX) return { ids: [...current], limit: true };
  return { ids: [...current, id], limit: false };
}

/** The i18n key of each message the form shows under its fields (empty `errors` means nothing to say per field). */
export function ideaErrorKeys(errors: IdeaInputErrors): { title?: string; description?: string; labels?: string } {
  return {
    title: errors.title === "required" ? "ideas.errors.titleRequired" : errors.title === "too_long" ? "ideas.errors.titleTooLong" : undefined,
    description: errors.description ? "ideas.errors.descriptionTooLong" : undefined,
    labels: errors.labels ? "ideas.errors.labelsTooMany" : undefined,
  };
}
