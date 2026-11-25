import type { ActivityItem, ActivityPage } from "./api";

/** Marks the rows with these ids read; rows already read and other rows are returned as they were. */
export function markRead(items: ActivityItem[], ids: readonly string[]): ActivityItem[] {
  const set = new Set(ids);
  return items.map((item) => (set.has(item.id) && !item.read ? { ...item, read: true } : item));
}

export function markAllRead(items: ActivityItem[]): ActivityItem[] {
  return items.map((item) => (item.read ? item : { ...item, read: true }));
}

export function unreadIds(items: ActivityItem[]): string[] {
  return items.filter((item) => !item.read).map((item) => item.id);
}

/** Adds the next page after the rows already shown, leaving out a row seen twice (a new event shifts the pages). */
export function appendPage(items: ActivityItem[], page: ActivityPage): ActivityItem[] {
  const seen = new Set(items.map((item) => item.id));
  return [...items, ...page.items.filter((item) => !seen.has(item.id))];
}

/**
 * Whether the bell shows its dot: any shown row is unread, or the server said so and rows are still to load.
 * A row marked read here can clear the dot at once; the next refresh from the server settles it.
 */
export function hasUnreadAfter(items: ActivityItem[], nextCursor: string | null, serverHasUnread: boolean): boolean {
  return items.some((item) => !item.read) || (nextCursor !== null && serverHasUnread);
}
