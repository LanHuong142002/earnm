import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { sourceLine, type CommentSource } from "./commentSource";

/** "Từ bình luận của <tên> ở “<tiêu đề>”": above the fields of a form opened from a comment. Display only (spec R7). */
export function CommentSourceLine({ source }: { source: CommentSource }) {
  const { t } = useTranslation();
  const { colors, typography, spacing, iconSize } = useTheme();
  const line = sourceLine(source);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
      <Ionicons name="chatbubble-outline" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={[typography.label, { flex: 1, color: colors.textSecondary }]}>{t(line.key, line.values)}</Text>
    </View>
  );
}
