// Mirrors apps/api/src/invites/code.ts: no 0, O, 1, I or L.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

export type JoinCodeState = { normalized: string | null; canSubmit: boolean };

/** Ignores case, spaces and dashes. `normalized` is the 8-character code, or null if it is not one. Pure. */
export function joinCodeState(input: string): JoinCodeState {
  const code = input.replace(/[\s-]/g, "").toUpperCase();
  const valid = code.length === CODE_LENGTH && [...code].every((ch) => CODE_ALPHABET.includes(ch));
  return { normalized: valid ? code : null, canSubmit: valid };
}
