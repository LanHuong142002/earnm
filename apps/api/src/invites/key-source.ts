/**
 * The text the invite hash key is derived from: INVITE_CODE_KEY when set, otherwise
 * INTERNAL_SECRET (so invites made before INVITE_CODE_KEY existed keep working).
 * Undefined means neither is set and the app uses a random key.
 */
export function pickInviteKeySource(config: {
  inviteCodeKey?: string | null;
  internalSecret?: string;
}): string | undefined {
  return config.inviteCodeKey || config.internalSecret;
}
