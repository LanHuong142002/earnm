import { ApiError } from "../lib/api";

export type MemberErrorContext = { memberCount?: number };

const KEYS: Record<string, string> = {
  network: "errors.network",
  invalid_invite: "errors.invalid_invite",
  already_member: "errors.already_member",
  project_full: "errors.project_full",
  too_many_invites: "errors.too_many_invites",
  too_many_attempts: "errors.too_many_attempts",
  forbidden: "errors.forbidden",
  not_found: "errors.not_found_member",
};

/** Maps a failed members/invites call to an i18n key. Pure; never throws. */
export function memberErrorKey(error: unknown, context: MemberErrorContext = {}): string {
  if (!(error instanceof ApiError)) return "errors.generic";
  if (error.code === "last_owner") {
    return context.memberCount === 1 ? "errors.last_owner_only_member" : "errors.last_owner";
  }
  return KEYS[error.code] ?? "errors.generic";
}
