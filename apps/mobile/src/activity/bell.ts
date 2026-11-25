/** The Home bell: the orange dot shows only while something is unread, and the accessible name says so too (R32). */
export function bellState(hasUnread: boolean): { showDot: boolean; labelKey: "activity.bell.label" | "activity.bell.labelUnread" } {
  return hasUnread
    ? { showDot: true, labelKey: "activity.bell.labelUnread" }
    : { showDot: false, labelKey: "activity.bell.label" };
}
