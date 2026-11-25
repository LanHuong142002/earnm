import type { ActivityType, PrismaClient } from "../../generated/prisma/client.js";

type Db = Pick<PrismaClient, "activityEvent" | "activityRecipient">;

/** Pushes for one person are held for this long so a burst goes out as one (R12). */
export const WINDOW_MS = 60_000;
/** An event older than this when it reaches the server is saved but never pushed (R9). */
export const LATE_AFTER_MS = 60 * 60_000;

/** Whoever must hear about new activity, after the route has been told to the scheduler. */
export interface ActivityScheduler {
  schedule(dueAt: Date): void;
}

export interface ActivityInput {
  type: ActivityType;
  projectId: string;
  actorId: string | null;
  taskId?: string | null;
  ideaId?: string | null;
  memberId?: string | null;
  subjectTitle: string;
  /** When the person did it: the phone's time when it sent one, else `now`. */
  occurredAt: Date;
  recipients: readonly string[];
  now: Date;
}

/**
 * Saves one event with a row per recipient, inside the caller's transaction so it commits or
 * rolls back with the change itself. The actor and duplicates are dropped. Returns the earliest
 * `dueAt` among the pending rows written (for the scheduler, after commit), or null when nothing
 * is due: no recipients left, or every row is late.
 */
export async function recordActivity(tx: Db, input: ActivityInput): Promise<Date | null> {
  const recipients = [...new Set(input.recipients)].filter((id) => id !== input.actorId);
  if (recipients.length === 0) return null;

  const { now } = input;
  const late = now.getTime() - input.occurredAt.getTime() > LATE_AFTER_MS;

  const event = await tx.activityEvent.create({
    data: {
      projectId: input.projectId,
      type: input.type,
      actorId: input.actorId,
      taskId: input.taskId ?? null,
      ideaId: input.ideaId ?? null,
      memberId: input.memberId ?? null,
      subjectTitle: input.subjectTitle,
      occurredAt: input.occurredAt,
    },
  });

  let earliest: Date | null = null;
  for (const userId of recipients) {
    let dueAt: Date | null = null;
    if (!late) {
      // Someone with a push still waiting joins that window instead of opening a new one.
      const open = await tx.activityRecipient.findFirst({
        where: { userId, pushState: "pending", dueAt: { gt: now } },
        orderBy: { dueAt: "asc" },
        select: { dueAt: true },
      });
      dueAt = open?.dueAt ?? new Date(now.getTime() + WINDOW_MS);
      if (!earliest || dueAt < earliest) earliest = dueAt;
    }
    await tx.activityRecipient.create({
      data: {
        eventId: event.id,
        userId,
        occurredAt: input.occurredAt,
        pushState: late ? "late" : "pending",
        dueAt,
      },
    });
  }
  return earliest;
}

/** Tells the scheduler after commit. Does nothing when no scheduler is set or nothing is due. */
export function scheduleAfterCommit(
  scheduler: ActivityScheduler | null | undefined,
  dueAt: Date | null,
): void {
  if (scheduler && dueAt) scheduler.schedule(dueAt);
}
