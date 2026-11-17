import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { PressableScale } from "../../ui/PressableScale";
import type { BellState } from "./view";

/**
 * The "Nhắc kèm" bell on a comment (spec R21). On: orange bell with "Nhắc". Off and tappable: grey outline.
 * On for someone who cannot change it: same look, not a button. Off for them: an empty slot, so rows stay aligned.
 */
export function CommentBell({ state, onPress }: { state: BellState; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, layout, iconSize } = useTheme();
  const slot = { minWidth: layout.controlHeight, minHeight: layout.controlHeight, alignItems: "center", justifyContent: "center" } as const;

  if (state === "hidden") return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={slot} />;

  const on = state !== "off-tappable";
  const content = (
    <>
      <Ionicons name={on ? "notifications" : "notifications-outline"} size={iconSize.sm} color={on ? colors.accentStrong : colors.textSecondary} />
      {on ? <Text style={[typography.caption, { color: colors.accentStrong }]}>{t("tasks.comments.bellOn")}</Text> : null}
    </>
  );

  if (state === "on-readonly") {
    return (
      <View accessible accessibilityLabel={t("tasks.comments.bellReadonlyA11y")} style={slot}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t(state === "on" ? "tasks.comments.bellOnA11y" : "tasks.comments.bellOffA11y")}
      accessibilityState={{ selected: state === "on" }}
      onPress={onPress}
      style={slot}
    >
      {content}
    </PressableScale>
  );
}
