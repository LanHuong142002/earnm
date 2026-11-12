import type { KeyValueStore } from "../sync/storage";

export type AppearanceChoice = "system" | "light" | "dark";

export const APPEARANCE_KEY = "appearance.v1";

/** Reads the saved choice. Missing, unreadable or unknown values read as "system". */
export async function readAppearance(store: KeyValueStore): Promise<AppearanceChoice> {
  try {
    const value = await store.getJSON<unknown>(APPEARANCE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export async function writeAppearance(store: KeyValueStore, choice: AppearanceChoice): Promise<void> {
  await store.setJSON(APPEARANCE_KEY, choice);
}

/** The value for Appearance.setColorScheme ("unspecified" hands control back to the system). */
export function schemeOverride(choice: AppearanceChoice): "light" | "dark" | "unspecified" {
  return choice === "system" ? "unspecified" : choice;
}
