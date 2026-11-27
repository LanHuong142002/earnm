export type AddAsKind = "idea" | "draft";

type Translate = (key: string, values?: Record<string, unknown>) => string;

export type CommentMenu = {
  title: string;
  items: { kind: AddAsKind; label: string }[];
  cancelLabel: string;
  /** The same two choices for a screen reader, with no long-press needed (spec R3). */
  accessibilityActions: { name: string; label: string }[];
};

const ACTION_NAME: Record<AddAsKind, string> = { idea: "addAsIdea", draft: "addAsDraft" };

/** The kind an accessibility action name stands for, or null for any other action. */
export function addAsKind(actionName: string): AddAsKind | null {
  return actionName === ACTION_NAME.idea ? "idea" : actionName === ACTION_NAME.draft ? "draft" : null;
}

/** What a long-press on a comment offers (spec R1-R3), or null while the comment is being edited. */
export function commentMenu({ editing, name, t }: { editing: boolean; name: string; t: Translate }): CommentMenu | null {
  if (editing) return null;
  const items: CommentMenu["items"] = [
    { kind: "idea", label: t("tasks.comments.addAsIdea") },
    { kind: "draft", label: t("tasks.comments.addAsDraft") },
  ];
  return {
    title: t("tasks.comments.menuTitle", { name }),
    items,
    cancelLabel: t("tasks.comments.cancel"),
    accessibilityActions: items.map((i) => ({ name: ACTION_NAME[i.kind], label: i.label })),
  };
}
