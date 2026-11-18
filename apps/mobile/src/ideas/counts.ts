import type { Idea } from "./types";

/** The "3 mới" on the project's Ý tưởng tile (spec R16): how many ideas are still New. */
export const newIdeaCount = (ideas: Idea[]): number => ideas.filter((i) => i.status === "new").length;
