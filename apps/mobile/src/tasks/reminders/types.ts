import type { ReminderRepeat } from "./occurrences";

export type { ReminderRepeat };

/** When a reminder fires (contract: spec R1-R3). `weekdays` is 0 = Sunday .. 6 = Saturday and only matters for "weekly". */
export type ReminderSchedule = {
  /** `YYYY-MM-DD` */
  startDate: string;
  /** `HH:mm` */
  time: string;
  /** IANA name */
  timezone: string;
  repeat: ReminderRepeat;
  weekdays: number[];
  /** `YYYY-MM-DD`, inclusive, or null. */
  endDate: string | null;
};

/** A reminder exactly as the API returns it. */
export type ServerReminder = ReminderSchedule & {
  id: string;
  taskId: string;
  recipientIds: string[];
  createdById: string | null;
  changedAt: string;
};

/** `synced` came from the server; `waiting` is queued on the phone. */
export type ReminderState = "synced" | "waiting";

/** A reminder as the screen shows it. */
export type Reminder = ServerReminder & { state: ReminderState };

/** One "Nhắc kèm" comment that rides along with a task's reminders. */
export type RemindWithLine = { author: string | null; text: string };

/** What `GET /projects/:projectId/reminders` answers. */
export type ProjectReminders = {
  reminders: ServerReminder[];
  /** By task id: the latest 3 "Nhắc kèm" comments, newest first. */
  remindWith: Record<string, RemindWithLine[]>;
};

/**
 * What a queued reminder change's `data` holds. Every change carries `projectId` and `taskId`.
 * - create: `schedule` and `recipients`, each with its own time, so edits made while it waits merge per part.
 * - update: only `schedule` (a whole `ReminderSchedule`) and/or `recipients` (user ids), each with its own time.
 * - delete: nothing more.
 */
export type ReminderChangeData = {
  projectId: string;
  taskId: string;
  schedule?: ReminderSchedule;
  recipients?: string[];
};
