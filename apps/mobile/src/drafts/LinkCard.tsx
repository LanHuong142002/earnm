import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { PressableScale } from "../ui/PressableScale";

/**
 * A card at the top of a screen that leads to the other end of a draft-product link (mockups A9 and A10):
 * a small caption, the name under it and a chevron. Without `onPress` it is plain text (the product is gone).
 */
export function LinkCard({ caption, title, onPress }: { caption: string; title?: string; onPress?: () => void }) {
  const { colors, typography, layout, spacing, iconSize } = useTheme();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], minHeight: layout.controlHeight + spacing[1], paddingHorizontal: spacing[2], paddingVertical: spacing[1] }}>
      <View style={{ flex: 1, gap: spacing[0] / 2 }}>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{caption}</Text>
        {title ? (
          <Text style={[typography.bodyStrong, { color: colors.text }]} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} /> : null}
    </View>
  );
  return (
    <Card flush>
      {onPress ? (
        <PressableScale accessibilityRole="link" accessibilityLabel={title ? `${caption}, ${title}` : caption} onPress={onPress}>
          {body}
        </PressableScale>
      ) : (
        <View accessible accessibilityLabel={caption}>
          {body}
        </View>
      )}
    </Card>
  );
}
