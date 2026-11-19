import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

// A section header that opens and closes its content. Starts closed. `trailing` is a short value read before the
// chevron (a total); `onToggle` tells the parent when it opens or closes.
export function Collapsible({
  title,
  trailing,
  onToggle,
  children,
}: {
  title: string;
  trailing?: string;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const { colors, typography, layout, iconSize, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: spacing[0] }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={trailing ? `${title}, ${trailing}` : title}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          onToggle?.(!open);
          setOpen(!open);
        }}
        style={{
          minHeight: layout.controlHeight,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={[typography.sectionTitle, { color: colors.text, flexShrink: 1 }]}>{title}</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
          {trailing ? <Text style={[typography.bodyStrong, { color: colors.text }]}>{trailing}</Text> : null}
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={iconSize.sm}
            color={colors.textSecondary}
          />
        </View>
      </PressableScale>
      {open ? children : null}
    </View>
  );
}
