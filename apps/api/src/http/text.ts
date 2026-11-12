import { z } from "zod";

// U+0000-U+001F and U+007F. PostgreSQL rejects NUL outright, and the rest never belong in a name.
const CONTROL = /[\u0000-\u001f\u007f]/;
// Same, except tab, line feed and carriage return, which a description may hold.
const CONTROL_EXCEPT_WHITESPACE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/** A single-line text field: trimmed, 1 to `max` characters, no control characters. */
export const singleLineText = (max: number) =>
  z.string().trim().min(1).max(max).refine((s) => !CONTROL.test(s), "No control characters.");

/** A multi-line text field: trimmed, up to `max` characters; control characters other than \n, \r and \t are refused. */
export const multiLineText = (max: number) =>
  z.string().trim().max(max).refine((s) => !CONTROL_EXCEPT_WHITESPACE.test(s), "No control characters.");
