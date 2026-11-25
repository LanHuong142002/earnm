import type { ActivityScheduler } from "./record.js";

/** Extra wait past a due time so the rows are surely due when the flush looks. */
const SLACK_MS = 500;

/**
 * Keeps one timer for the earliest due time asked for, then runs `flush`. After a flush nothing
 * more is scheduled until `schedule` is called again; the periodic tick catches stragglers.
 */
export function createTimerScheduler(
  flush: () => Promise<unknown>,
  now: () => Date,
): ActivityScheduler {
  let timer: NodeJS.Timeout | null = null;
  let firesAt = Infinity;

  return {
    schedule(dueAt) {
      const fireAt = Math.max(dueAt.getTime(), now().getTime()) + SLACK_MS;
      if (timer && firesAt <= fireAt) return;
      if (timer) clearTimeout(timer);
      firesAt = fireAt;
      timer = setTimeout(() => {
        timer = null;
        firesAt = Infinity;
        flush().catch((err: unknown) => {
          console.error("activity: flush failed", err instanceof Error ? err.name : "unknown");
        });
      }, fireAt - now().getTime());
      timer.unref();
    },
  };
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
