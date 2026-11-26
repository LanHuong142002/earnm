import type { Idea } from "./types";

type MaybeCounted = Omit<Idea, "likeCount" | "dislikeCount"> & Partial<Pick<Idea, "likeCount" | "dislikeCount">>;

/**
 * The idea with both vote counts. One that came without them (a copy cached by an older app, or a server that
 * does not send them yet) gets them from its score: up votes are the positive part, down votes the negative part.
 */
export function withVoteCounts(idea: MaybeCounted): Idea {
  return {
    ...idea,
    likeCount: idea.likeCount ?? Math.max(idea.score, 0),
    dislikeCount: idea.dislikeCount ?? Math.max(-idea.score, 0),
  };
}
