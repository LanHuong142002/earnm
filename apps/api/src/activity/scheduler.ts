import type { ActivityScheduler } from "./record.js";

/** Extra wait past a due time so the rows are surely due when the flush looks. */
const SLACK_MS = 500;

/**
 * Keeps one timer for the earliest due time asked for (an earlier time replaces a later pending
 * one), then runs `flush`. When the flush returns `{ nextDueAt }` the scheduler re-arms for that
 * time, so a later window or a retry needs no tick; the periodic tick still catches stragglers.
 */
export function createTimerScheduler(
  flush: () => Promise<unknown>,
  now: () => Date,
): ActivityScheduler {
  let timer: NodeJS.Timeout | null = null;
  let firesAt = Infinity;

  const scheduler: ActivityScheduler = {
    schedule(dueAt) {
      const fireAt = Math.max(dueAt.getTime(), now().getTime()) + SLACK_MS;
      if (timer && firesAt <= fireAt) return;
      if (timer) clearTimeout(timer);
      firesAt = fireAt;
      timer = setTimeout(() => {
        timer = null;
        firesAt = Infinity;
        flush()
          .then((result) => {
            const next = (result as { nextDueAt?: unknown } | null | undefined)?.nextDueAt;
            if (next instanceof Date) scheduler.schedule(next);
          })
          .catch((err: unknown) => {
            console.error("activity: flush failed", err instanceof Error ? err.name : "unknown");
          });
      }, fireAt - now().getTime());
      timer.unref();
    },
  };
  return scheduler;
}

/** For tests: records the due times asked for and flushes only when told to. */
export function createManualScheduler(flush?: () => Promise<unknown>): ActivityScheduler & {
  requested: Date[];
  run: () => Promise<void>;
} {
  const requested: Date[] = [];
  return {
    requested,
    schedule(dueAt) {
      requested.push(dueAt);
    },
    async run() {
      await flush?.();
    },
  };
}
