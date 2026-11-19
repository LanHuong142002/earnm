import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Enter } from "../ui/Enter";
import { PressableScale } from "../ui/PressableScale";
import { productNoticeKeys } from "./outcomes";
import { useProducts } from "./ProductsProvider";

/** Tells the person a product or extra cost change could not be saved (spec R14). Same look as the ingredient notice. */
export function ProductRejectedNotice() {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout } = useTheme();
  const { rejectedNotice, dismissRejectedNotice } = useProducts();
  if (!rejectedNotice) return null;
  const keys = productNoticeKeys(rejectedNotice);
  return (
    <Enter index={0}>
      <View accessibilityRole="alert" style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}>
        <Text style={[typography.bodyStrong, { color: colors.danger }]}>{t(keys.headline, { name: rejectedNotice.name ?? "" })}</Text>
        <Text style={[typography.label, { color: colors.danger }]}>{t(keys.reason)}</Text>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("projects.dismiss")}
          onPress={dismissRejectedNotice}
          style={{ minHeight: layout.controlHeight, justifyContent: "center" }}
        >
          <Text style={[typography.bodyStrong, { color: colors.danger }]}>{t("projects.dismiss")}</Text>
        </PressableScale>
      </View>
    </Enter>
  );
}
