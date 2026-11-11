import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";

/**
 * Header back control aligned with the screen's content padding. The native one sits
 * about 8pt from the edge, closer than the 20pt gutter the content uses. The swipe-back
 * gesture is unaffected: it belongs to the stack, not to this button.
 */
export function HeaderBack({ canGoBack }: { canGoBack?: boolean }) {
  const { t } = useTranslation();
  const { colors, layout, header, iconSize } = useTheme();
  if (!canGoBack) return null;
  return (
    <Pressable
      onPress={() => router.back()}
      accessibilityRole="button"
      accessibilityLabel={t("common.back")}
      style={({ pressed }) => ({
        // The native header already adds some inset; this brings the chevron to the gutter.
        marginLeft: header.backInset,
        minWidth: layout.controlHeight,
        height: layout.controlHeight,
        justifyContent: "center",
        alignItems: "flex-start",
        opacity: pressed ? 0.5 : 1,
      })}
    >
      <Ionicons name="chevron-back" size={iconSize.md} color={colors.accentStrong} />
    </Pressable>
  );
}
