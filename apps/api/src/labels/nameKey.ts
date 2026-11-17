/**
 * The form of a label name used to compare names: trimmed, NFC-normalised and lower-cased,
 * so "Pha chế" and " PHA CHẾ " are the same label (R6).
 */
export function nameKey(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}
