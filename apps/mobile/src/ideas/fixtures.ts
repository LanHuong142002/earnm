import type { Idea } from "./types";

/** An idea for tests; every field can be overridden. */
export function idea(overrides: Partial<Idea> & { id: string }): Idea {
  return {
    projectId: "p1",
    author: { id: "u1", displayName: "An" },
    title: "Ý tưởng",
    description: "",
    status: "new",
    labelIds: [],
    score: 0,
    myVote: 0,
    commentCount: 0,
    photoCount: 0,
    taskId: null,
    task: null,
    createdAt: "2026-11-10T09:00:00.000Z",
    ...overrides,
  };
}
