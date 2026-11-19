import { canEditComment, isInvolved } from "../permissions";
import type { Comment, CommentOrder } from "./types";

export { canEditComment, isInvolved };

/** Comments appear five at a time (spec R18). */
export const COMMENT_BATCH = 5;
/** The longest comment text, after trimming (spec R24). */
export const COMMENT_MAX = 1000;

function byTime(a: Comment, b: Comment): number {
  const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  if (diff !== 0) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A sorted copy: oldest first, or newest first (the exact reverse). */
export function sortComments<T extends Comment>(list: T[], order: CommentOrder): T[] {
  const sorted = [...list].sort(byTime);
  return order === "newest" ? sorted.reverse() : sorted;
}

export type CommentPage = {
  items: Comment[];
  /** How many are on screen (never more than the list). */
  shown: number;
  /** How many more "Xem thêm bình luận (N)" would reveal. */
  remaining: number;
  /** True when every comment is on screen and there is at least one: "Đã xem hết bình luận". */
  allShown: boolean;
};

/** The first `shown` comments in the chosen order. */
export function pageComments(list: Comment[], order: CommentOrder, shown: number): CommentPage {
  const sorted = sortComments(list, order);
  const items = sorted.slice(0, Math.max(0, shown));
  return { items, shown: items.length, remaining: sorted.length - items.length, allShown: sorted.length > 0 && items.length === sorted.length };
}

/** The `shown` count after pressing "Xem thêm bình luận". */
export function nextShown(shown: number, total: number): number {
  return Math.min(total, shown + COMMENT_BATCH);
}

export type BellState = "on" | "off-tappable" | "on-readonly" | "hidden";

/** The bell on a comment (spec R21): involved people can switch it either way; others only see it when it is on. */
export function bellState(remindWith: boolean, viewerInvolved: boolean): BellState {
  if (viewerInvolved) return remindWith ? "on" : "off-tappable";
  return remindWith ? "on-readonly" : "hidden";
}

/** The bell of a parent: a parent with no reminder flag (`canFlag` absent) never shows one. */
export const bellFor = (canFlag: boolean | undefined, remindWith: boolean): BellState =>
  canFlag === undefined ? "hidden" : bellState(remindWith, canFlag);

export type LengthCheck = {
  /** Characters after trimming. */
  length: number;
  /** How many characters to remove to fit; 0 when it fits. */
  over: number;
  empty: boolean;
  canSend: boolean;
};

/** Spec R24: 1 to 1000 characters after trimming. */
export function lengthCheck(text: string): LengthCheck {
  const length = text.trim().length;
  const over = Math.max(0, length - COMMENT_MAX);
  return { length, over, empty: length === 0, canSend: length > 0 && over === 0 };
}

/** The author's name, or the neutral `fallback` ("Người dùng cũ") once the account is gone. */
export function authorName(comment: Pick<Comment, "author">, fallback: string): string {
  return comment.author?.displayName ?? fallback;
}

export function authorInitial(comment: Pick<Comment, "author">, fallback: string): string {
  const name = authorName(comment, fallback).trim();
  return name === "" ? "?" : Array.from(name)[0]!.toUpperCase();
}
