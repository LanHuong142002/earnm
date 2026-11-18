/**
 * When a reminder fires. Pure, no dependencies.
 *
 * KEEP IDENTICAL with apps/mobile/src/tasks/reminders/occurrences.ts (the phone schedules
 * the same instants the server would send). Change both together.
 *
 * Occurrences are the wall-clock `time` in `timezone` on:
 *  - once: startDate
 *  - daily: every day from startDate
 *  - weekly: each chosen weekday (0 = Sunday .. 6 = Saturday) on or after startDate
 *  - monthly: startDate's day of the month, or the month's last day when it is shorter
 * None fall after the end of `endDate` (that day included).
 */

export type ReminderRepeat = "once" | "daily" | "weekly" | "monthly";

export interface ReminderRule {
  /** "YYYY-MM-DD" */
  startDate: string;
  /** "HH:MM", 24 hours */
  time: string;
  /** IANA name such as "Asia/Ho_Chi_Minh" */
  timezone: string;
  repeat: ReminderRepeat;
  /** Used only by "weekly": 0 = Sunday .. 6 = Saturday. */
  weekdays: number[];
  /** "YYYY-MM-DD", inclusive, or null for no end. */
  endDate: string | null;
}

const DAY_MS = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** The zone's offset from UTC in milliseconds at this instant (positive east of Greenwich). */
function offsetMs(instantMs: number, timezone: string): number {
  const whole = Math.floor(instantMs / 1000) * 1000;
  const parts: Record<string, number> = {};
  for (const p of formatter(timezone).formatToParts(new Date(whole))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    parts["year"] ?? 1970,
    (parts["month"] ?? 1) - 1,
    parts["day"] ?? 1,
    parts["hour"] ?? 0,
    parts["minute"] ?? 0,
    parts["second"] ?? 0,
  );
  return asUtc - whole;
}

/** The UTC instant at which a clock in `timezone` reads this date and time. */
function zonedInstant(dayNumber: number, minutes: number, timezone: string): number {
  const wallAsUtc = dayNumber * DAY_MS + minutes * 60_000;
  const first = offsetMs(wallAsUtc, timezone);
  const guess = wallAsUtc - first;
  const second = offsetMs(guess, timezone);
  // Near a clock change the first guess can land on the other side of it.
  return second === first ? guess : wallAsUtc - second;
}

/** Days since 1970-01-01 for "YYYY-MM-DD". */
function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/** Every instant the rule fires with `from <= instant <= to`, oldest first. */
export function occurrencesBetween(rule: ReminderRule, from: Date, to: Date): Date[] {
  const start = dayNumber(rule.startDate);
  const last = rule.endDate === null ? Infinity : dayNumber(rule.endDate);
  const minutes = minutesOf(rule.time);
  const startDay = new Date(start * DAY_MS).getUTCDate();

  // A zone's calendar day can differ from the UTC day by up to a day either way.
  const first = Math.max(start, Math.floor(from.getTime() / DAY_MS) - 1);
  const stop = Math.min(last, Math.floor(to.getTime() / DAY_MS) + 1);

  const out: Date[] = [];
  for (let day = first; day <= stop; day++) {
    if (!fires(rule, day, start, startDay)) continue;
    const at = zonedInstant(day, minutes, rule.timezone);
    if (at >= from.getTime() && at <= to.getTime()) out.push(new Date(at));
  }
  return out;
}

function fires(rule: ReminderRule, day: number, start: number, startDay: number): boolean {
  switch (rule.repeat) {
    case "once":
      return day === start;
    case "daily":
      return true;
    case "weekly":
      // 1970-01-01 was a Thursday (4).
      return rule.weekdays.includes((((day + 4) % 7) + 7) % 7);
    case "monthly": {
      const d = new Date(day * DAY_MS);
      return d.getUTCDate() === Math.min(startDay, daysInMonth(d.getUTCFullYear(), d.getUTCMonth()));
    }
  }
}

/**
 * False only for a "once" rule whose moment is not after `now`; every other rule
 * repeats, so it is always acceptable.
 */
export function isFutureOnce(rule: ReminderRule, now: Date): boolean {
  if (rule.repeat !== "once") return true;
  return zonedInstant(dayNumber(rule.startDate), minutesOf(rule.time), rule.timezone) > now.getTime();
}
