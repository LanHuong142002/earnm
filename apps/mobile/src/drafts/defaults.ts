import type { Draft } from "./types";

type MaybeLinked = Omit<Draft, "ideaId" | "idea" | "photoCount"> & Partial<Pick<Draft, "ideaId" | "idea" | "photoCount">>;

/**
 * The draft with the idea link and photo count. One that came without them (a copy cached by an older app, or
 * a server that does not send them yet) is "not made from an idea, no photos".
 */
export function withDraftDefaults(draft: MaybeLinked): Draft {
  return { ...draft, ideaId: draft.ideaId ?? null, idea: draft.idea ?? null, photoCount: draft.photoCount ?? 0 };
}
