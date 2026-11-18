import type { PrismaClient } from "../../generated/prisma/client.js";
import { occurrencesBetween } from "../reminders/occurrences.js";
import type { PushMessage, PushSender } from "./sender.js";

/** How far back a tick looks for occurrences it may have missed. */
export const CATCH_UP_WINDOW_MS = 15 * 60_000;
const MAX_COMMENT_LINES = 3;
const MAX_COMMENT_LINE_LENGTH = 100;

type Language = "vi" | "en";

const WEEKDAYS: Record<Language, string[]> = {
  vi: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
};
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `T6, 14/11 · 14:30` (vi) or `Fri, 14 Nov · 14:30` (en); the time is left out when there is none. */
function formatDue(dueDate: Date, dueTime: string | null, lang: Language): string {
  const d = dueDate.getUTCDate();
  const m = dueDate.getUTCMonth();
  const weekday = WEEKDAYS[lang][dueDate.getUTCDay()];
  const day = lang === "vi" ? `${d}/${m + 1}` : `${d} ${MONTHS_EN[m]}`;
  const base = `${weekday}, ${day}`;
  return dueTime === null ? base : `${base} · ${dueTime}`;
}

function cut(line: string): string {
  const chars = Array.from(line.replace(/\s+/g, " ").trim());
  return chars.length <= MAX_COMMENT_LINE_LENGTH ? chars.join("") : `${chars.slice(0, MAX_COMMENT_LINE_LENGTH - 1).join("")}…`;
}

function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Sends the reminders that came due since the previous tick (at most 15 minutes back) to the
 * people whose phones may not have scheduled them: recipients none of whose devices synced
 * after the reminder's content last changed. Each occurrence goes to each person at most once.
 */
export async function runCatchUp(deps: {
  prisma: PrismaClient;
  sender: PushSender;
  now: Date;
}): Promise<{ sent: number }> {
  const { prisma, sender, now } = deps;
  const previous = await prisma.tickState.findUnique({ where: { id: "tick" } });
  const earliest = now.getTime() - CATCH_UP_WINDOW_MS;
  // The previous tick already covered everything up to and including its own time.
  const from = new Date(Math.max(earliest, previous ? previous.lastTickAt.getTime() + 1 : earliest));

  const sent = from.getTime() <= now.getTime() ? await sendDue(prisma, sender, from, now) : 0;
  await prisma.tickState.upsert({
    where: { id: "tick" },
    create: { id: "tick", lastTickAt: now },
    update: { lastTickAt: now },
  });
  return { sent };
}

async function sendDue(prisma: PrismaClient, sender: PushSender, from: Date, now: Date): Promise<number> {
  const reminders = await prisma.taskReminder.findMany({
    where: {
      task: { status: { not: "done" } },
      recipients: { some: { user: { pushTokens: { some: {} } } } },
    },
    include: {
      task: { include: { project: { select: { name: true } } } },
      recipients: {
        include: { user: { select: { id: true, language: true, pushTokens: { select: { token: true, projectSyncs: { select: { projectId: true, lastSyncedAt: true } } } } } } },
      },
    },
  });
  if (reminders.length === 0) return 0;

  const taskIds = [...new Set(reminders.map((r) => r.taskId))];
  const comments = await prisma.taskComment.findMany({
    where: { taskId: { in: taskIds }, remindWith: true },
    include: { author: { select: { displayName: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const byTask = new Map<string, typeof comments>();
  for (const c of comments) byTask.set(c.taskId, [...(byTask.get(c.taskId) ?? []), c]);

  const messages: PushMessage[] = [];
  const claims: { reminderId: string; userId: string; occurrenceAt: Date }[] = [];
  for (const reminder of reminders) {
    const occurrences = occurrencesBetween(
      {
        startDate: toDay(reminder.startDate),
        time: reminder.time,
        timezone: reminder.timezone,
        repeat: reminder.repeat,
        weekdays: reminder.weekdays,
        endDate: reminder.endDate ? toDay(reminder.endDate) : null,
      },
      from,
      now,
    );
    if (occurrences.length === 0) continue;

    const taskComments = byTask.get(reminder.taskId) ?? [];
    let version = reminder.changedAt.getTime();
    for (const c of taskComments) version = Math.max(version, c.createdAt.getTime(), c.remindWithEditedAt.getTime());
    const commentLines = taskComments
      .slice(0, MAX_COMMENT_LINES)
      .map((c) => cut(c.author ? `${c.author.displayName}: ${c.text}` : c.text));
    const { task } = reminder;

    for (const { user } of reminder.recipients) {
      if (user.pushTokens.length === 0) continue;
      const outOfDate = user.pushTokens.every(
        (t) => !t.projectSyncs.some((s) => s.projectId === task.projectId && s.lastSyncedAt.getTime() >= version),
      );
      if (!outOfDate) continue;
      const lang: Language = user.language === "en" ? "en" : "vi";
      const head = task.dueDate
        ? `${formatDue(task.dueDate, task.dueTime, lang)} · ${task.project.name}`
        : task.project.name;
      const body = [head, ...commentLines].join("\n");

      for (const occurrenceAt of occurrences) {
        // The insert is the claim: only the caller whose row is new may send.
        const { count } = await prisma.reminderPushSent.createMany({
          data: [{ reminderId: reminder.id, userId: user.id, occurrenceAt }],
          skipDuplicates: true,
        });
        if (count === 0) continue;
        claims.push({ reminderId: reminder.id, userId: user.id, occurrenceAt });
        for (const { token } of user.pushTokens) {
          messages.push({ to: token, title: task.title, body, data: { projectId: task.projectId, taskId: task.id } });
        }
      }
    }
  }
  if (messages.length === 0) return 0;

  let invalidTokens: string[] = [];
  try {
    ({ invalidTokens } = await sender.send(messages));
  } catch {
    console.error("push: sending failed");
    // Release this batch's claims so the next tick retries it.
    await prisma.reminderPushSent.deleteMany({ where: { OR: claims } });
    return 0;
  }
  if (invalidTokens.length > 0) {
    await prisma.devicePushToken.deleteMany({ where: { token: { in: invalidTokens } } });
  }
  return messages.length;
}
