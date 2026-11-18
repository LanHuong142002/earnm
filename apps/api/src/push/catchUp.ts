import type { Prisma, PrismaClient } from "../../generated/prisma/client.js";
import { occurrencesBetween } from "../reminders/occurrences.js";
import { latestRemindWithComments } from "../reminders/remindWithComments.js";
import type { PushMessage, PushSender } from "./sender.js";

/** How far back a tick looks for occurrences it may have missed. */
export const CATCH_UP_WINDOW_MS = 15 * 60_000;
const MAX_COMMENT_LINE_LENGTH = 100;
/** A claim not yet delivered is retried after this long, until it is an hour old. */
const RETRY_AFTER_MS = 2 * 60_000;
const RETRY_UNTIL_MS = 60 * 60_000;
export const MAX_ATTEMPTS = 3;
const DAY_MS = 86_400_000;
/** Advisory lock key of the tick: a second tick running at the same time returns at once. */
export const TICK_LOCK_KEY = 1_010_001;

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

interface Claim {
  reminderId: string;
  userId: string;
  occurrenceAt: Date;
}

function claimKey(c: Claim): string {
  return `${c.reminderId}|${c.userId}|${c.occurrenceAt.getTime()}`;
}

/**
 * Sends the reminders that came due since the previous tick (at most 15 minutes back) to the
 * people whose phones may not have scheduled them: recipients none of whose devices synced
 * after the reminder's content last changed. Each occurrence is delivered to each person once;
 * a send that failed, or was cut short, is retried up to 3 times within an hour. Only one tick
 * runs at a time.
 */
export async function runCatchUp(deps: {
  prisma: PrismaClient;
  sender: PushSender;
  now: Date;
}): Promise<{ sent: number }> {
  const { prisma } = deps;
  // The transaction only holds the lock (released when it ends); the work uses other connections.
  return prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${TICK_LOCK_KEY}::bigint) AS locked`;
      if (!row?.locked) return { sent: 0 };
      return tick(deps);
    },
    { timeout: 5 * 60_000, maxWait: 10_000 },
  );
}

async function tick(deps: { prisma: PrismaClient; sender: PushSender; now: Date }): Promise<{ sent: number }> {
  const { prisma, sender, now } = deps;
  const previous = await prisma.tickState.findUnique({ where: { id: "tick" } });
  const earliest = now.getTime() - CATCH_UP_WINDOW_MS;
  // The previous tick already covered everything up to and including its own time.
  const from = new Date(Math.max(earliest, previous ? previous.lastTickAt.getTime() + 1 : earliest));

  const sent = await sendDue(prisma, sender, from, now);
  await prisma.tickState.upsert({
    where: { id: "tick" },
    create: { id: "tick", lastTickAt: now },
    update: { lastTickAt: now },
  });
  return { sent };
}

async function sendDue(prisma: PrismaClient, sender: PushSender, from: Date, now: Date): Promise<number> {
  const windowOpen = from.getTime() <= now.getTime();
  // Claims not delivered yet that are due another try.
  const retryRows = await prisma.reminderPushSent.findMany({
    where: {
      sentAt: null,
      attempts: { lt: MAX_ATTEMPTS },
      lastAttemptAt: { lte: new Date(now.getTime() - RETRY_AFTER_MS) },
      claimedAt: { gt: new Date(now.getTime() - RETRY_UNTIL_MS) },
    },
  });
  const retryReminderIds = [...new Set(retryRows.map((r) => r.reminderId))];

  // Narrow in SQL to reminders that can have an occurrence in the window. A local date differs
  // from the UTC date by at most a day either way, hence the day of slack.
  const mayOccur: Prisma.TaskReminderWhereInput[] = [];
  if (windowOpen) {
    mayOccur.push({
      startDate: { lte: new Date(now.getTime() + DAY_MS) },
      OR: [{ endDate: null }, { endDate: { gte: new Date(from.getTime() - DAY_MS) } }],
    });
  }
  if (retryReminderIds.length > 0) mayOccur.push({ id: { in: retryReminderIds } });
  if (mayOccur.length === 0) return 0;

  const reminders = await prisma.taskReminder.findMany({
    where: {
      task: { status: { not: "done" } },
      recipients: { some: { user: { pushTokens: { some: {} } } } },
      OR: mayOccur,
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
  const latest = await latestRemindWithComments(prisma, taskIds);
  // The content version covers every "Nhắc kèm" comment, not only the latest few.
  const versions = await prisma.taskComment.groupBy({
    by: ["taskId"],
    where: { taskId: { in: taskIds }, remindWith: true },
    _max: { createdAt: true, remindWithEditedAt: true },
  });
  const commentVersion = new Map(
    versions.map((v) => [v.taskId, Math.max(v._max.createdAt?.getTime() ?? 0, v._max.remindWithEditedAt?.getTime() ?? 0)]),
  );

  const retryKeys = new Set(retryRows.map(claimKey));
  const messages: PushMessage[] = [];
  const messageClaim: Claim[] = [];

  for (const reminder of reminders) {
    const occurrences = windowOpen
      ? occurrencesBetween(
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
        )
      : [];
    const retries = retryRows.filter((r) => r.reminderId === reminder.id);
    if (occurrences.length === 0 && retries.length === 0) continue;

    const version = Math.max(reminder.changedAt.getTime(), commentVersion.get(reminder.taskId) ?? 0);
    const commentLines = (latest.get(reminder.taskId) ?? []).map((c) => cut(c.author ? `${c.author}: ${c.text}` : c.text));
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

      const toSend: Date[] = [];
      for (const occurrenceAt of occurrences) {
        if (retryKeys.has(claimKey({ reminderId: reminder.id, userId: user.id, occurrenceAt }))) continue; // a retry, below
        // The insert is the claim: only the caller whose row is new may send.
        const { count } = await prisma.reminderPushSent.createMany({
          data: [{ reminderId: reminder.id, userId: user.id, occurrenceAt, claimedAt: now, lastAttemptAt: now }],
          skipDuplicates: true,
        });
        if (count === 1) toSend.push(occurrenceAt);
      }
      for (const row of retries) {
        if (row.userId !== user.id) continue;
        // Take the retry: only one caller can move the attempt count on.
        const { count } = await prisma.reminderPushSent.updateMany({
          where: { reminderId: row.reminderId, userId: row.userId, occurrenceAt: row.occurrenceAt, sentAt: null, attempts: row.attempts },
          data: { attempts: { increment: 1 }, lastAttemptAt: now },
        });
        if (count === 1) toSend.push(row.occurrenceAt);
      }
      for (const occurrenceAt of toSend) {
        for (const { token } of user.pushTokens) {
          messages.push({ to: token, title: task.title, body, data: { projectId: task.projectId, taskId: task.id } });
          messageClaim.push({ reminderId: reminder.id, userId: user.id, occurrenceAt });
        }
      }
    }
  }
  if (messages.length === 0) return 0;

  let invalidTokens: string[] = [];
  let delivered: boolean[] = messages.map(() => false);
  try {
    ({ invalidTokens, delivered } = await sender.send(messages));
  } catch (err) {
    // Nothing was delivered: the claims stay unsent and a later tick retries them.
    console.error("push: sending failed", err instanceof Error ? err.name : "unknown");
  }
  if (invalidTokens.length > 0) {
    await prisma.devicePushToken.deleteMany({ where: { token: { in: invalidTokens } } });
  }

  // A claim is done when any of its messages arrived, or when everything that failed was a token
  // that is gone (there is nothing left to retry on those devices).
  const invalid = new Set(invalidTokens);
  const claims = new Map<string, { claim: Claim; delivered: boolean; retryable: boolean }>();
  let count = 0;
  messages.forEach((m, i) => {
    const claim = messageClaim[i]!;
    const entry = claims.get(claimKey(claim)) ?? { claim, delivered: false, retryable: false };
    if (delivered[i]) {
      count += 1;
      entry.delivered = true;
    } else if (!invalid.has(m.to)) entry.retryable = true;
    claims.set(claimKey(claim), entry);
  });
  for (const { claim, delivered: ok, retryable } of claims.values()) {
    if (ok || !retryable) {
      await prisma.reminderPushSent.updateMany({ where: { ...claim, sentAt: null }, data: { sentAt: now } });
    }
  }
  return count;
}
