import type { ActivityType, PrismaClient } from "../../generated/prisma/client.js";
import { LATE_AFTER_MS } from "../activity/record.js";
import { buildActivityMessage, type ActivityLanguage } from "./activityText.js";
import { deliverPushes } from "./deliver.js";
import type { PushMessage, PushSender } from "./sender.js";

/** A failed send is tried again after this long, at most MAX_ATTEMPTS times in all. */
const RETRY_AFTER_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;
export const ACTIVITY_LOCK_KEY = 1_016_001;
/** Candidates handled per flush; the rest wait for the next one. */
const BATCH = 2000;

const NEEDS_TASK: ReadonlySet<ActivityType> = new Set(["assigned", "comment", "done"]);

export interface FlushSummary {
  /** Recipient rows delivered. */
  sent: number;
  dropped: number;
  muted: number;
}

/**
 * Sends the activity pushes that came due: one per person per project, listing the newest events.
 * Rows too old, for someone who left the project, or whose task or idea is gone are dropped;
 * rows the person muted are marked muted. Rows are claimed with a compare-and-set before sending
 * so no event goes out twice. Only one flush runs at a time. Without a sender nothing happens.
 */
export async function flushActivity(deps: {
  prisma: PrismaClient;
  sender: PushSender | null | undefined;
  now: Date;
}): Promise<FlushSummary> {
  const none: FlushSummary = { sent: 0, dropped: 0, muted: 0 };
  const { prisma, sender } = deps;
  if (!sender) return none;
  // The transaction only holds the lock (released when it ends); the work uses other connections.
  return prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${ACTIVITY_LOCK_KEY}::bigint) AS locked`;
      if (!row?.locked) return none;
      return flush(prisma, sender, deps.now);
    },
    { timeout: 5 * 60_000, maxWait: 10_000 },
  );
}

async function flush(prisma: PrismaClient, sender: PushSender, now: Date): Promise<FlushSummary> {
  const summary: FlushSummary = { sent: 0, dropped: 0, muted: 0 };
  const rows = await prisma.activityRecipient.findMany({
    where: {
      pushState: "pending",
      attempts: { lt: MAX_ATTEMPTS },
      OR: [
        { attempts: 0, dueAt: { lte: now } },
        { attempts: { gt: 0 }, lastAttemptAt: { lte: new Date(now.getTime() - RETRY_AFTER_MS) } },
      ],
    },
    include: {
      user: { select: { language: true } },
      event: {
        include: {
          project: { select: { name: true } },
          actor: { select: { displayName: true } },
          member: { select: { displayName: true } },
        },
      },
    },
    orderBy: { occurredAt: "desc" },
    take: BATCH,
  });
  if (rows.length === 0) return summary;

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const projectIds = [...new Set(rows.map((r) => r.event.projectId))];
  const [members, typeMutes, projectMutes] = await Promise.all([
    prisma.projectMember.findMany({
      where: { userId: { in: userIds }, projectId: { in: projectIds } },
      select: { userId: true, projectId: true },
    }),
    prisma.notificationTypeMute.findMany({ where: { userId: { in: userIds } } }),
    prisma.projectNotificationMute.findMany({
      where: { userId: { in: userIds }, projectId: { in: projectIds } },
    }),
  ]);
  const memberKeys = new Set(members.map((m) => `${m.userId}|${m.projectId}`));
  const typeMuteKeys = new Set(typeMutes.map((m) => `${m.userId}|${m.type}`));
  const projectMuteKeys = new Set(projectMutes.map((m) => `${m.userId}|${m.projectId}`));
  const oldest = now.getTime() - LATE_AFTER_MS;

  type Row = (typeof rows)[number];
  const toDrop: Row[] = [];
  const toMute: Row[] = [];
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const e = r.event;
    const gone =
      e.occurredAt.getTime() < oldest ||
      !memberKeys.has(`${r.userId}|${e.projectId}`) ||
      (NEEDS_TASK.has(e.type) && !e.taskId) ||
      (e.type === "idea" && !e.ideaId);
    if (gone) toDrop.push(r);
    else if (
      typeMuteKeys.has(`${r.userId}|${e.type}`) ||
      projectMuteKeys.has(`${r.userId}|${e.projectId}`)
    )
      toMute.push(r);
    else {
      const key = `${r.userId}|${e.projectId}`;
      const list = groups.get(key);
      if (list) list.push(r);
      else groups.set(key, [r]);
    }
  }
  summary.dropped += await settle(prisma, toDrop, { pushState: "dropped" });
  summary.muted += await settle(prisma, toMute, { pushState: "muted" });

  for (const group of groups.values()) {
    // Claim each row; a concurrent runner that got there first leaves it out of this send.
    const claimed: Row[] = [];
    for (const r of group) {
      const { count } = await prisma.activityRecipient.updateMany({
        where: { eventId: r.eventId, userId: r.userId, pushState: "pending", attempts: r.attempts },
        data: { attempts: { increment: 1 }, lastAttemptAt: now },
      });
      if (count === 1) claimed.push({ ...r, attempts: r.attempts + 1 });
    }
    if (claimed.length === 0) continue;

    const first = claimed[0]!;
    const tokens = await prisma.devicePushToken.findMany({ where: { userId: first.userId } });
    if (tokens.length === 0) {
      summary.dropped += await settle(prisma, claimed, { pushState: "dropped" });
      continue;
    }

    const lang: ActivityLanguage = first.user.language === "en" ? "en" : "vi";
    const events = claimed.map((r) => r.event); // newest first (query order)
    const { title, body } = buildActivityMessage(
      lang,
      first.event.project.name,
      events.map((e) => ({
        type: e.type,
        actorName: e.actor?.displayName ?? null,
        subjectTitle: e.subjectTitle,
        memberName: e.member?.displayName ?? null,
      })),
    );
    const data = {
      kind: "activity",
      projectId: first.event.projectId,
      target: targetOf(events),
      eventIds: events.map((e) => e.id),
    };
    const messages: PushMessage[] = tokens.map((t) => ({ to: t.token, title, body, data }));
    const { delivered } = await deliverPushes(prisma, sender, messages);

    if (delivered.some(Boolean)) {
      summary.sent += await settle(prisma, claimed, { pushState: "sent", sentAt: now });
    } else {
      const exhausted = claimed.filter((r) => r.attempts >= MAX_ATTEMPTS);
      summary.dropped += await settle(prisma, exhausted, { pushState: "dropped" });
    }
  }
  return summary;
}

type Target =
  | { type: "task"; taskId: string }
  | { type: "idea"; ideaId: string }
  | { type: "members" }
  | { type: "project" };

function targetOf(
  events: { type: ActivityType; taskId: string | null; ideaId: string | null }[],
): Target {
  const first = events[0]!;
  if (
    first.taskId &&
    NEEDS_TASK.has(first.type) &&
    events.every((e) => NEEDS_TASK.has(e.type) && e.taskId === first.taskId)
  )
    return { type: "task", taskId: first.taskId };
  if (first.ideaId && events.every((e) => e.type === "idea" && e.ideaId === first.ideaId))
    return { type: "idea", ideaId: first.ideaId };
  if (events.every((e) => e.type === "member_joined")) return { type: "members" };
  return { type: "project" };
}

async function settle(
  prisma: PrismaClient,
  rows: { eventId: string; userId: string }[],
  data: { pushState: "sent" | "dropped" | "muted"; sentAt?: Date },
): Promise<number> {
  if (rows.length === 0) return 0;
  const { count } = await prisma.activityRecipient.updateMany({
    where: { pushState: "pending", OR: rows.map((r) => ({ eventId: r.eventId, userId: r.userId })) },
    data,
  });
  return count;
}
