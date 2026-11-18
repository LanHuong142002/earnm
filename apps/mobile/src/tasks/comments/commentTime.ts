import { formatDue, type DueLanguage } from "../dueDate";

function dayNumber(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * When a comment was written, in the phone's local time: `8:30` today, `Hôm qua 20:14` yesterday,
 * otherwise weekday and date as on the due date (`T3, 10/11`). Names come from `t`, never from Intl.
 */
export function formatCommentTime(iso: string, now: Date, lang: DueLanguage, t: (key: string) => string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const clock = (d: Date) => `${d.getHours()}:${pad(d.getMinutes())}`;
  const ago = dayNumber(now) - dayNumber(at);
  if (ago <= 0) return clock(at);
  if (ago === 1) return `${t("tasks.comments.yesterday")} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return formatDue(`${at.getFullYear()}-${at.getMonth() + 1}-${at.getDate()}`, null, lang, t);
}
