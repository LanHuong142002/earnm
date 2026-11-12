import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { Member } from "../lib/api";
import { useTheme } from "../theme/useTheme";
import { AVATAR_SIZE, Avatar } from "../ui/Avatar";
import { avatarRowModel } from "./avatarRow";

const OVERLAP = -11;
const GAP = 6;

/** Overlapping initials plus a dashed "+"; the whole row opens the member list. Hidden without a cached list. */
export function MembersAvatarRow({ members, onPress }: { members: Member[] | null; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors, iconSize } = useTheme();
  if (!members || members.length === 0) return null;
  const { avatars, more } = avatarRowModel(members);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t("members.rowLabel", { count: members.length })}
      style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", minHeight: 44 }}
    >
      {avatars.map((a, i) => (
        <View key={a.userId} style={{ marginLeft: i === 0 ? 0 : OVERLAP }}>
          <Avatar letter={a.initial} />
        </View>
      ))}
      {more !== null ? (
        <View style={{ marginLeft: OVERLAP }}>
          <Avatar letter={`+${more}`} muted />
        </View>
      ) : null}
      <View
        style={{
          marginLeft: GAP,
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          borderRadius: AVATAR_SIZE / 2,
          backgroundColor: colors.background,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="add" size={iconSize.sm} color={colors.accent} />
      </View>
    </Pressable>
  );
}
