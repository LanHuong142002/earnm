import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { useActivity } from "./ActivityProvider";
import { bellState } from "./bell";

const DOT = 10;
const RING = 2;

/** The bell at the right of the Home header: opens Activity, and wears an orange dot only while something is unread (R32). */
export function ActivityBell() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, iconSize, layout } = useTheme();
  const { hasUnread } = useActivity();
  const { showDot, labelKey } = bellState(hasUnread);

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t(labelKey)}
      onPress={() => router.push("/activity")}
      style={{ width: layout.controlHeight, height: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
    >
      <Ionicons name="notifications-outline" size={iconSize.lg} color={colors.accentStrong} />
      {showDot ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            top: 10,
            right: 11,
            width: DOT + RING * 2,
            height: DOT + RING * 2,
            borderRadius: (DOT + RING * 2) / 2,
            backgroundColor: colors.accent,
            borderWidth: RING,
            borderColor: colors.background,
          }}
        />
      ) : null}
    </PressableScale>
  );
}
