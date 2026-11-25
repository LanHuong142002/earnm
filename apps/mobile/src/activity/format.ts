import type { TapTarget } from "../tasks/reminders/notificationLogic";
import type { ActivityItem, ActivityType } from "./api";

/** The translate function the formatters need; `useTranslation().t` fits. Keeps this module free of React. */
export type Translate = (key: string, options?: Record<string, string | number>) => string;

export type DayGroup = "today" | "yesterday" | "earlier";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight (local) of the day `date` falls on. */
function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Which day group a moment belongs to, by calendar day on the phone (R30). A time in the future counts as today. */
export function groupByDay(occurredAt: string, now: Date): DayGroup {
  const at = new Date(occurredAt);
  const today = startOfDay(now);
  const day = startOfDay(at);
  if (day >= today) return "today";
  if (day >= startOfDay(new Date(today - DAY_MS / 2))) return "yesterday";
  return "earlier";
}

const two = (n: number) => String(n).padStart(2, "0");

/** "2 phút trước" / "2 min ago" today, "Hôm qua, 20:14" yesterday, "21/11" before that (the year too when it differs). */
export function relativeTime(occurredAt: string, now: Date, t: Translate): string {
  const at = new Date(occurredAt);
  const group = groupByDay(occurredAt, now);
  if (group === "today") {
    const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
    if (minutes < 1) return t("activity.time.justNow");
    if (minutes < 60) return t("activity.time.minutesAgo", { n: minutes });
    return t("activity.time.hoursAgo", { n: Math.floor(minutes / 60) });
  }
  if (group === "yesterday") {
    return t("activity.time.yesterdayAt", { time: `${two(at.getHours())}:${two(at.getMinutes())}` });
  }
  const date = `${two(at.getDate())}/${two(at.getMonth() + 1)}`;
  return at.getFullYear() === now.getFullYear() ? date : `${date}/${at.getFullYear()}`;
}

/** The sentence of a row: "{actor} assigned you {title}" and the like. A missing name reads as "Someone". */
export function rowText(item: ActivityItem, t: Translate): string {
  const named = (name: string | null) => (name !== null && name.trim() !== "" ? name : t("activity.someone"));
  if (item.type === "member_joined") return t("activity.text.member_joined", { name: named(item.memberName ?? item.actorName) });
  const title = item.subjectTitle !== null && item.subjectTitle.trim() !== "" ? item.subjectTitle : t("activity.noTitle");
  return t(`activity.text.${item.type}`, { actor: named(item.actorName), title });
}

/** The "{project} · {when}" line under a row. */
export function metaLine(item: ActivityItem, now: Date, t: Translate): string {
  const when = relativeTime(item.occurredAt, now, t);
  return item.projectName !== null && item.projectName !== "" ? `${item.projectName} · ${when}` : when;
}

/** Where a tap on the row goes, in the same shape a push tap uses (R17, R30). */
export function rowTarget(item: ActivityItem): TapTarget {
  const { projectId } = item;
  switch (item.type) {
    case "assigned":
    case "comment":
    case "done":
      return item.taskId !== null ? { type: "task", projectId, taskId: item.taskId } : { type: "project", projectId };
    case "idea":
      return item.ideaId !== null ? { type: "idea", projectId, ideaId: item.ideaId } : { type: "project", projectId };
    case "member_joined":
      return { type: "members", projectId };
  }
}

export type ActivityIcon =
  | "clipboard-outline"
  | "chatbubble-outline"
  | "checkmark-circle-outline"
  | "bulb-outline"
  | "person-add-outline";

const ICONS: Record<ActivityType, ActivityIcon> = {
  assigned: "clipboard-outline",
  comment: "chatbubble-outline",
  done: "checkmark-circle-outline",
  idea: "bulb-outline",
  member_joined: "person-add-outline",
};

export const activityIcon = (type: ActivityType): ActivityIcon => ICONS[type];

export type ActivitySection = { group: DayGroup; items: ActivityItem[] };

/** The feed as day sections in the order given (newest first); an empty group is left out. */
export function sectionsOf(items: ActivityItem[], now: Date): ActivitySection[] {
  const sections: ActivitySection[] = [];
  for (const item of items) {
    const group = groupByDay(item.occurredAt, now);
    const last = sections[sections.length - 1];
    if (last && last.group === group) last.items.push(item);
    else sections.push({ group, items: [item] });
  }
  return sections;
}
