import { DRAFT_NAME_MAX, DRAFT_NOTE_MAX } from "../../drafts/view";
import { capUnits, cutAtWord } from "../../ideas/draftPrefill";
import { TITLE_MAX } from "../../ideas/plan";
import { COMMENT_MAX } from "./view";

/** The comment a new idea or drink draft is made from (spec #51). Display and prefill only: it is never stored. */
export type CommentSource = {
  text: string;
  /** Empty when the author is unknown (the account is gone). */
  authorName: string;
  /** The title of the task or idea the comment is on. */
  sourceTitle: string;
};

/** The longest author name or source title carried in the route params. */
const LABEL_MAX = 120;

/** Capped in UTF-16 code units, as the forms and the server count, never splitting a character. */
const cap = capUnits;

/**
 * The first sentence of a comment (spec R6): up to and including the first ".", "!", "?" or "…" that is followed by a
 * space, a line break or the end, or up to the first line break, whichever comes first. A dot inside "3.5k" is not an
 * end. Trimmed; the whole (trimmed) text when it has no ending.
 */
export function firstSentence(text: string): string {
  const whole = text.trim();
  const lineBreak = whole.search(/[\r\n]/);
  const limit = lineBreak === -1 ? whole.length : lineBreak;
  let end = limit;
  for (let i = 0; i < limit; i++) {
    if (!/[.!?…]/.test(whole[i]!)) continue;
    const next = whole[i + 1];
    if (next === undefined || /\s/.test(next)) {
      end = i + 1;
      break;
    }
  }
  return whole.slice(0, end).trim() || whole;
}

/** The New idea fields: the first sentence as the title (at most 120), the whole comment as the description. */
export function ideaFromComment(source: CommentSource): { title: string; description: string } {
  return { title: cutAtWord(firstSentence(source.text), TITLE_MAX), description: source.text };
}

/** The New draft fields: the first sentence as the name (at most 60), the comment cut to 500 as the note. */
export function draftFromComment(source: CommentSource): { name: string; note: string } {
  return { name: cutAtWord(firstSentence(source.text), DRAFT_NAME_MAX), note: cap(source.text, DRAFT_NOTE_MAX) };
}

/** The i18n key and values of the line above the fields: names the author, or a fallback when the name is unknown (spec R7). */
export function sourceLine(source: CommentSource): { key: string; values: Record<string, string> } {
  const name = source.authorName.trim();
  return name === ""
    ? { key: "tasks.comments.sourceLineUnknown", values: { title: source.sourceTitle } }
    : { key: "tasks.comments.sourceLine", values: { name, title: source.sourceTitle } };
}

/** The route params that carry a comment to the New idea or New draft screen. */
export function commentSourceParams(source: CommentSource): Record<string, string> {
  return { fromComment: "1", commentText: source.text, commentAuthor: source.authorName, commentTitle: source.sourceTitle };
}

type RawParams = Record<string, string | string[] | undefined>;

const single = (value: unknown): string => (typeof value === "string" ? value : "");

/** The comment a screen was opened from, or null when its params are missing or malformed. Lengths are capped. */
export function readCommentSource(params: RawParams): CommentSource | null {
  if (params.fromComment !== "1") return null;
  const text = single(params.commentText);
  if (text.trim() === "") return null;
  return {
    text: cap(text, COMMENT_MAX),
    authorName: cap(single(params.commentAuthor), LABEL_MAX),
    sourceTitle: cap(single(params.commentTitle), LABEL_MAX),
  };
}
