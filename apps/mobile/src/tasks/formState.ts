import type { TaskEdit } from "./optimistic";
import type { Task } from "./types";
import type { TaskInput } from "./validate";

/** What the task form holds. */
export type TaskForm = {
  title: string;
  description: string;
  status: string;
  dueDate: string | null;
  dueTime: string | null;
  assigneeIds: string[];
};

export function emptyForm(): TaskForm {
  return { title: "", description: "", status: "todo", dueDate: null, dueTime: null, assigneeIds: [] };
}

export function formFromTask(task: Task): TaskForm {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    dueDate: task.dueDate,
    dueTime: task.dueTime,
    assigneeIds: task.assignees.map((a) => a.id),
  };
}

export function inputFromForm(form: TaskForm): TaskInput {
  return { ...form, assigneeIds: [...form.assigneeIds] };
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

/** Only the fields that differ from what the form opened with, so a refresh in between isn't reverted. */
export function editFromForm(opened: TaskForm, form: TaskForm): TaskEdit {
  const edit: TaskEdit = {};
  if (form.title !== opened.title) edit.title = form.title;
  if (form.description !== opened.description) edit.description = form.description;
  if (form.status !== opened.status) edit.status = form.status;
  if (form.dueDate !== opened.dueDate) {
    edit.dueDate = form.dueDate;
    // Clearing the day clears the time with it.
    if (form.dueDate === null) edit.dueTime = null;
  }
  if (form.dueTime !== opened.dueTime) edit.dueTime = form.dueTime;
  if (!sameIds(opened.assigneeIds, form.assigneeIds)) edit.assigneeIds = [...form.assigneeIds];
  return edit;
}

export const setDay = (form: TaskForm, day: string): TaskForm => ({ ...form, dueDate: day });
export const clearDay = (form: TaskForm): TaskForm => ({ ...form, dueDate: null, dueTime: null });
/** A time needs a day; without one the call changes nothing. */
export const setTime = (form: TaskForm, time: string): TaskForm =>
  form.dueDate === null ? form : { ...form, dueTime: time };
export const clearTime = (form: TaskForm): TaskForm => ({ ...form, dueTime: null });

const two = (n: number) => String(n).padStart(2, "0");

/** `YYYY-MM-DD` of the phone's local calendar day. */
export function dateToDay(date: Date): string {
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

export function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

/** `HH:mm`, 24-hour. */
export function dateToTime(date: Date): string {
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The picker's value: the day at `time`, or at noon when no time is set yet. */
export function timeToDate(day: string, time: string | null): Date {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time === null ? [12, 0] : time.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}
