import { formatDue, type DueLanguage } from "../dueDate";
import type { Task } from "../types";
import { occurrencesBetween } from "./occurrences";
import type { RemindWithLine, Reminder } from "./types";

/** Only this far ahead is scheduled; the phone plans again after every sync and on every app start. */
export const HORIZON_DAYS = 14;
/** iOS keeps at most 64 pending local notifications; the nearest win. */
export const MAX_PENDING = 64;
const MAX_COMMENT_LINES = 3;
const MAX_LINE_LENGTH = 100;
const DAY_MS = 86_400_000;

/** A local notification to schedule. `identifier` is `reminderId@iso` of the moment, so planning again gives the same ones. */
export type PlannedNotification = {
  identifier: string;
  at: Date;
  title: string;
  body: string;
  data: { projectId: string; taskId: string };
};

export type PlanInput = {
  reminders: Reminder[];
  tasks: Task[];
  /** By task id: the latest "Nhắc kèm" comments, newest first. */
  remindWith: Record<string, RemindWithLine[]>;
  projectNames: Record<string, string>;
  meId: string;
  now: Date;
  lang: DueLanguage;
  t: (key: string) => string;
};

function cut(line: string): string {
  const chars = Array.from(line.replace(/\s+/g, " ").trim());
  return chars.length <= MAX_LINE_LENGTH ? chars.join("") : `${chars.slice(0, MAX_LINE_LENGTH - 1).join("")}…`;
}

/** Spec R16, the same text the server sends: due date and time with the project, then up to 3 "Name: text" lines. */
function contentFor(task: Task, input: PlanInput): { title: string; body: string } {
  const project = input.projectNames[task.projectId] ?? "";
  const head =
    task.dueDate === null
      ? project
      : [formatDue(task.dueDate, task.dueTime, input.lang, input.t), project].filter((s) => s !== "").join(" · ");
  const lines = (input.remindWith[task.id] ?? [])
    .slice(0, MAX_COMMENT_LINES)
    .map((c) => cut(c.author ? `${c.author}: ${c.text}` : c.text));
  return { title: task.title, body: [head, ...lines].filter((s) => s !== "").join("\n") };
}

/**
 * The notifications to schedule now: for each reminder that goes to me on a task that is not done, every moment in
 * the next 14 days, then the 64 nearest. Pure: the same input gives the same output.
 */
export function planNotifications(input: PlanInput): PlannedNotification[] {
  const tasks = new Map(input.tasks.map((t) => [t.id, t]));
  const from = new Date(input.now.getTime() + 1);
  const to = new Date(input.now.getTime() + HORIZON_DAYS * DAY_MS);
  const out: PlannedNotification[] = [];
  for (const reminder of input.reminders) {
    if (!reminder.recipientIds.includes(input.meId)) continue;
    const task = tasks.get(reminder.taskId);
    if (!task || task.status === "done") continue;
    const { title, body } = contentFor(task, input);
    for (const at of occurrencesBetween(reminder, from, to)) {
      out.push({ identifier: `${reminder.id}@${at.toISOString()}`, at, title, body, data: { projectId: task.projectId, taskId: task.id } });
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.identifier < b.identifier ? -1 : 1));
  return out.slice(0, MAX_PENDING);
}
