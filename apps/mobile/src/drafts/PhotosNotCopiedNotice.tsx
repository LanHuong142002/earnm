import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Enter } from "../ui/Enter";
import { PressableScale } from "../ui/PressableScale";

/**
 * Tells the person, once, that some idea photos did not come along (mockup E2). Grey, not red: the draft was made.
 * Same shape as the rejected-draft notice, with the field background.
 */
export function PhotosNotCopiedNotice({ count, onDismiss }: { count: number; onDismiss: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  return (
    <Enter index={0}>
      <View
        accessibilityRole="alert"
        style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], paddingLeft: spacing[2], borderRadius: radius.card, backgroundColor: colors.field }}
      >
        <Text style={[typography.label, { flex: 1, color: colors.text, paddingVertical: spacing[1] }]}>{t("drafts.photosNotCopied", { count })}</Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("drafts.photosNotCopiedDismiss")}
          onPress={onDismiss}
          style={{ minWidth: layout.controlHeight, minHeight: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
        >
          <Ionicons name="close" size={iconSize.sm} color={colors.textSecondary} />
        </PressableScale>
      </View>
    </Enter>
  );
}
