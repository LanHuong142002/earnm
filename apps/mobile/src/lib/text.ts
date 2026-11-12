// Mirrors the server: names and titles refuse U+0000-U+001F and U+007F; descriptions may keep \n, \r and \t.
// The phone strips them instead, so pasted text never reaches the sync queue in a form the server refuses.
const CONTROL = /[\u0000-\u001f\u007f]/g;
const CONTROL_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Strips every control character, then trims. */
export function cleanSingleLine(value: string): string {
  return value.replace(CONTROL, "").trim();
}

/** Strips control characters except tab, line feed and carriage return, then trims. */
export function cleanMultiLine(value: string): string {
  return value.replace(CONTROL_EXCEPT_WHITESPACE, "").trim();
}
