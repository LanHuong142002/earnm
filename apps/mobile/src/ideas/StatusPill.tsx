import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { ideaStatusTone } from "./screenView";
import type { IdeaStatus } from "./types";

/**
 * The status of an idea as a small pill. "Đã chọn" keeps its check icon (spec R21); the name is always written, so
 * colour is never the only sign.
 */
export function StatusPill({ status }: { status: IdeaStatus }) {
  const { t } = useTranslation();
  const { colors, labelColors, typography, radius, spacing } = useTheme();
  const tone = ideaStatusTone(status);
  const pair =
    tone === "accent"
      ? { bg: colors.tile, text: colors.accentStrong }
      : tone === "blue"
        ? labelColors.blue
        : tone === "green"
          ? labelColors.green
          : { bg: colors.field, text: colors.textSecondary };
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[0],
        alignSelf: "flex-start",
        backgroundColor: pair.bg,
        borderRadius: radius.pill,
        paddingVertical: spacing[0] / 2,
        paddingHorizontal: spacing[1],
      }}
    >
      {status === "accepted" ? <Ionicons name="checkmark" size={typography.label.fontSize} color={pair.text} /> : null}
      <Text style={[typography.caption, { color: pair.text, fontFamily: typography.label.fontFamily }]}>
        {t(`ideas.status.${status}`)}
      </Text>
    </View>
  );
}
