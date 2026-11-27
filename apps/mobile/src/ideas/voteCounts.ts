import type { Idea } from "./types";

type MaybeCounted = Omit<Idea, "likeCount" | "dislikeCount" | "draftId" | "draft"> &
  Partial<Pick<Idea, "likeCount" | "dislikeCount" | "draftId" | "draft">>;

/**
 * The idea with both vote counts. One that came without them (a copy cached by an older app, or a server that
 * does not send them yet) gets them from its score: up votes are the positive part, down votes the negative part.
 * The same copy also gets "no draft" (`draftId` and `draft` null) when it has none of the draft fields.
 */
export function withVoteCounts(idea: MaybeCounted): Idea {
  return {
    ...idea,
    likeCount: idea.likeCount ?? Math.max(idea.score, 0),
    dislikeCount: idea.dislikeCount ?? Math.max(-idea.score, 0),
    draftId: idea.draftId ?? null,
    draft: idea.draft ?? null,
  };
}
