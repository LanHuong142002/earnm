import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";

import { layout } from "../theme/tokens";
import { useTheme } from "../theme/useTheme";

/**
 * Header back control aligned with the screen's content padding. The native one sits
 * about 8pt from the edge, closer than the 20pt gutter the content uses. The swipe-back
 * gesture is unaffected: it belongs to the stack, not to this button.
 */
export function HeaderBack({ canGoBack }: { canGoBack?: boolean }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  if (!canGoBack) return null;
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel={t("common.back")}
      hitSlop={12}
      style={({ pressed }) => ({
        // The native header already adds some inset; this brings the chevron to the gutter.
        marginLeft: layout.screenPadding - 16,
        minWidth: layout.controlHeight,
        height: layout.controlHeight,
        justifyContent: "center",
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Ionicons name="chevron-back" size={28} color={colors.accentStrong} />
    </Pressable>
  );
}
