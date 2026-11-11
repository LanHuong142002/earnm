import { Ionicons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

// A section header that opens and closes its content. Starts closed.
export function Collapsible({ title, children }: { title: string; children: ReactNode }) {
  const { colors, typography, layout, iconSize, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: spacing[0] }}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={{
          minHeight: layout.controlHeight,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={[typography.sectionTitle, { color: colors.text }]}>{title}</Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={iconSize.sm}
          color={colors.textSecondary}
        />
      </PressableScale>
      {open ? children : null}
    </View>
  );
}
