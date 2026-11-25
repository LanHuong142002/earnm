import type { NotificationSettings, NotificationType } from "./api";

/** One switch the person flipped: a notification type, or one project's mute. */
export type SettingsChange =
  | { kind: "type"; type: NotificationType; enabled: boolean }
  | { kind: "mute"; projectId: string; muted: boolean };

/** The settings with the change shown at once (R24: the switch moves before the server answers). */
export function applyChange(settings: NotificationSettings, change: SettingsChange): NotificationSettings {
  if (change.kind === "type") {
    return { ...settings, types: { ...settings.types, [change.type]: change.enabled } };
  }
  const rest = settings.mutedProjectIds.filter((id) => id !== change.projectId);
  return { ...settings, mutedProjectIds: change.muted ? [...rest, change.projectId] : rest };
}

/**
 * Puts the one switch back the way it was after a failed save (AC27). Only that switch moves, so another change made
 * while this one was on its way is kept.
 */
export function revertChange(settings: NotificationSettings, change: SettingsChange): NotificationSettings {
  return applyChange(
    settings,
    change.kind === "type" ? { ...change, enabled: !change.enabled } : { ...change, muted: !change.muted },
  );
}

export const isMuted = (settings: NotificationSettings | null, projectId: string): boolean =>
  settings?.mutedProjectIds.includes(projectId) ?? false;

export type SaveOutcome = { settings: NotificationSettings; failed: boolean };

/** Runs one change: shows it, sends it, and takes it back if the send fails. `current` reads the latest settings. */
export async function saveChange(
  current: () => NotificationSettings,
  show: (next: NotificationSettings) => void,
  send: (change: SettingsChange) => Promise<unknown>,
  change: SettingsChange,
): Promise<SaveOutcome> {
  show(applyChange(current(), change));
  try {
    await send(change);
    return { settings: current(), failed: false };
  } catch {
    const reverted = revertChange(current(), change);
    show(reverted);
    return { settings: reverted, failed: true };
  }
}
