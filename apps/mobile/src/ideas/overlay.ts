import type { Change } from "../sync/queue";
import { IDEA_ENTITY, IDEA_LABELS_ENTITY, IDEA_VOTE_ENTITY } from "./entities";
import { IDEA_STATUSES, type Idea, type IdeaStatus, type Vote } from "./types";

const isStatus = (v: unknown): v is IdeaStatus => (IDEA_STATUSES as readonly unknown[]).includes(v);
const isVote = (v: unknown): v is Vote => v === -1 || v === 0 || v === 1;

/** The vote a press on the up arrow (`1`) or the down arrow (`-1`) makes: pressing your own vote again takes it back. */
export const toggleVote = (current: Vote, pressed: 1 | -1): Vote => (current === pressed ? 0 : pressed);

/**
 * The idea with the viewer's vote changed to `value`: the score moves by the difference, so a switch from up to
 * down moves it by 2. The old vote leaves its count and the new one joins its own; no count goes below 0.
 */
export const withVote = (idea: Idea, value: Vote): Idea => ({
  ...idea,
  score: idea.score - idea.myVote + value,
  likeCount: Math.max(0, idea.likeCount - (idea.myVote === 1 ? 1 : 0) + (value === 1 ? 1 : 0)),
  dislikeCount: Math.max(0, idea.dislikeCount - (idea.myVote === -1 ? 1 : 0) + (value === -1 ? 1 : 0)),
  myVote: value,
});

const isIdeaChange = (change: Change, projectId: string) =>
  (change.entity === IDEA_ENTITY || change.entity === IDEA_LABELS_ENTITY || change.entity === IDEA_VOTE_ENTITY) &&
  change.data.projectId === projectId;

/** Applies every field a queued idea change carries (title, description, status). */
function withFields(idea: Idea, data: Record<string, unknown>): Idea {
  const next = { ...idea };
  if (typeof data.title === "string") next.title = data.title;
  if (typeof data.description === "string") next.description = data.description;
  if (isStatus(data.status)) next.status = data.status;
  return next;
}

function created(change: Change, projectId: string): Idea {
  const authorId = typeof change.data.authorId === "string" ? change.data.authorId : null;
  return withFields(
    {
      id: change.entityId,
      projectId,
      author: authorId === null ? null : { id: authorId, displayName: typeof change.data.authorName === "string" ? change.data.authorName : "" },
      title: "",
      description: "",
      status: "new",
      labelIds: [],
      score: 0,
      likeCount: 0,
      dislikeCount: 0,
      myVote: 0,
      commentCount: 0,
      photoCount: 0,
      taskId: null,
      task: null,
      draftId: null,
      draft: null,
      createdAt: change.createdAt,
    },
    change.data,
  );
}

/**
 * One project's ideas as the screen shows them: the server's list with the changes still waiting laid over it,
 * in the order they were made. A waiting create is an idea, a waiting edit shows its new values, a waiting label
 * set replaces the labels, a waiting delete hides the idea, and a waiting vote moves the score and the viewer's
 * own vote at once. Changes for an idea that is not there are ignored. The list must be the server's: laying
 * the same changes over an already laid-over list would count a vote twice.
 */
export function applyIdeaOverlay(projectId: string, serverList: Idea[], waiting: Change[]): Idea[] {
  let list = serverList;
  for (const change of waiting) {
    if (!isIdeaChange(change, projectId)) continue;
    const index = list.findIndex((i) => i.id === change.entityId);
    if (change.entity === IDEA_ENTITY) {
      if (change.kind === "delete") {
        list = list.filter((i) => i.id !== change.entityId);
      } else if (index === -1) {
        if (change.kind === "create") list = [...list, created(change, projectId)];
      } else {
        list = list.map((i, n) => (n === index ? withFields(i, change.data) : i));
      }
      continue;
    }
    if (index === -1 || change.kind === "delete") continue;
    if (change.entity === IDEA_LABELS_ENTITY) {
      const labels = change.data.labels;
      if (Array.isArray(labels)) {
        const ids = labels.filter((id): id is string => typeof id === "string");
        list = list.map((i, n) => (n === index ? { ...i, labelIds: ids } : i));
      }
    } else if (isVote(change.data.value)) {
      const value = change.data.value;
      list = list.map((i, n) => (n === index ? withVote(i, value) : i));
    }
  }
  return list;
}

/** The ideas of `projectId` with a change waiting (a create, an edit, a label set or a vote): they show "Chờ lưu". */
export function pendingIdeaIds(projectId: string, waiting: Change[]): ReadonlySet<string> {
  return new Set(waiting.filter((c) => isIdeaChange(c, projectId)).map((c) => c.entityId));
}
