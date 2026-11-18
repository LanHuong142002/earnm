import { useCallback, useEffect, useMemo, useState } from "react";

import { newProjectId } from "../../projects/newProjectId";
import { useProjects } from "../../projects/ProjectsProvider";
import { asyncStorageStore } from "../../sync/asyncStorageStore";
import type { Change, NewChange } from "../../sync/queue";
import { MAX_REMINDERS_PER_TASK, changesFromForm, validateReminderForm, scheduleFromForm, type ReminderForm, type ReminderFormErrors } from "./formState";
import { applyReminderOverlay } from "./overlay";
import { loadReminderCache, subscribeReminders, type ReminderCache } from "./store";
import { reminderCreateChange, reminderDeleteChange, reminderRecipientsChange, reminderScheduleChange } from "./sync";
import type { RemindWithLine, Reminder } from "./types";

export type ReminderResult =
  | { ok: true }
  | { ok: false; reason: "not_ready" | "limit" | "not_found" }
  | { ok: false; reason: "invalid"; errors: ReminderFormErrors };

type Options = {
  projectId: string;
  taskId: string;
  /** The signed-in person's id (the saved copy counts while the profile request is pending). */
  meId: string | null;
};

export type TaskReminders = {
  /** This task's reminders with the waiting changes laid over them, oldest first. */
  reminders: Reminder[];
  /** The latest "Nhắc kèm" comments that ride along, newest first. */
  remindWith: RemindWithLine[];
  /** The saved copy is not read yet. */
  loading: boolean;
  add: (form: ReminderForm) => Promise<ReminderResult>;
  /** Saves what differs between `opened` (what the form opened with) and `form`; each part is its own queued change. */
  edit: (reminderId: string, opened: ReminderForm, form: ReminderForm) => Promise<ReminderResult>;
  remove: (reminderId: string) => Promise<ReminderResult>;
};

/** Shows and changes one task's reminders. The project's reminders are fetched by the sync cycle; changes go through the shared queue, so they work offline. */
export function useTaskReminders({ projectId, taskId, meId }: Options): TaskReminders {
  const { sync } = useProjects();
  const { queue, afterEnqueue, onFlushed } = sync;

  const key = `${meId}|${projectId}`;
  const [local, setLocal] = useState<{ key: string; cache: ReminderCache; waiting: Change[] } | null>(null);
  const current = local?.key === key ? local : null;

  const readLocal = useCallback(async () => {
    if (meId === null) return;
    const [cache, waiting] = await Promise.all([loadReminderCache(asyncStorageStore, meId), queue.waiting()]);
    setLocal({ key, cache, waiting });
  }, [meId, queue, key]);

  useEffect(() => {
    void Promise.resolve().then(readLocal);
    const off = subscribeReminders(() => void readLocal());
    const offFlush = onFlushed(() => void readLocal());
    return () => {
      off();
      offFlush();
    };
  }, [readLocal, onFlushed]);

  const server = current?.cache.byProject[projectId];
  const reminders = useMemo(
    () => applyReminderOverlay(server?.reminders ?? [], current?.waiting ?? [], projectId).filter((r) => r.taskId === taskId),
    [server, current, projectId, taskId],
  );
  const remindWith = server?.remindWith[taskId] ?? [];
  const ready = meId !== null && current !== null;

  const record = useCallback(
    async (...changes: NewChange[]) => {
      for (const change of changes) await queue.enqueue(change);
      await readLocal();
      await afterEnqueue();
    },
    [queue, readLocal, afterEnqueue],
  );

  const add = useCallback<TaskReminders["add"]>(
    async (form) => {
      if (!ready) return { ok: false, reason: "not_ready" };
      const errors = validateReminderForm(form, new Date());
      if (Object.keys(errors).length > 0) return { ok: false, reason: "invalid", errors };
      if (reminders.length >= MAX_REMINDERS_PER_TASK) return { ok: false, reason: "limit" };
      await record(reminderCreateChange({ projectId, taskId, id: newProjectId(), schedule: scheduleFromForm(form), recipients: form.recipientIds, now: new Date() }));
      return { ok: true };
    },
    [ready, reminders.length, record, projectId, taskId],
  );

  const edit = useCallback<TaskReminders["edit"]>(
    async (reminderId, opened, form) => {
      if (!ready) return { ok: false, reason: "not_ready" };
      if (!reminders.some((r) => r.id === reminderId)) return { ok: false, reason: "not_found" };
      const changes = changesFromForm(opened, form);
      const now = new Date();
      // Only a changed schedule is checked for being in the future: saving a past one-off's recipients is fine.
      const errors = validateReminderForm(form, now);
      if (changes.schedule === undefined) delete errors.date;
      if (Object.keys(errors).length > 0) return { ok: false, reason: "invalid", errors };
      const queued: NewChange[] = [];
      // Each part goes as its own change, so two phones editing different parts both win.
      if (changes.schedule) queued.push(reminderScheduleChange({ projectId, taskId, id: reminderId, schedule: changes.schedule, now }));
      if (changes.recipients) queued.push(reminderRecipientsChange({ projectId, taskId, id: reminderId, recipients: changes.recipients, now }));
      if (queued.length > 0) await record(...queued);
      return { ok: true };
    },
    [ready, reminders, record, projectId, taskId],
  );

  const remove = useCallback<TaskReminders["remove"]>(
    async (reminderId) => {
      if (!ready) return { ok: false, reason: "not_ready" };
      if (!reminders.some((r) => r.id === reminderId)) return { ok: false, reason: "not_found" };
      await record(reminderDeleteChange({ projectId, taskId, id: reminderId }));
      return { ok: true };
    },
    [ready, reminders, record, projectId, taskId],
  );

  return { reminders, remindWith, loading: !ready, add, edit, remove };
}
