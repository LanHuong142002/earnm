import type { Member } from "../lib/api";

export const MAX_AVATARS = 3;
const FALLBACK_INITIAL = "?";

export type AvatarRowModel = {
  avatars: { userId: string; initial: string }[];
  more: number | null;
};

export function initialOf(displayName: string): string {
  const first = Array.from(displayName.trim())[0];
  return first ? first.toLocaleUpperCase("vi") : FALLBACK_INITIAL;
}

/** First three members in the given order, plus how many are not shown. */
export function avatarRowModel(members: Member[]): AvatarRowModel {
  return {
    avatars: members.slice(0, MAX_AVATARS).map((m) => ({ userId: m.userId, initial: initialOf(m.displayName) })),
    more: members.length > MAX_AVATARS ? members.length - MAX_AVATARS : null,
  };
}
