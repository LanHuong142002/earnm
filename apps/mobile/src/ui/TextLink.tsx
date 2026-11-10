import { Link, type Href } from "expo-router";
import { Text } from "react-native";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "./PressableScale";

// A text link with a full-height touch target (layout.controlHeight), centred.
export function TextLink({ href, label }: { href: Href; label: string }) {
  const { colors, typography, layout } = useTheme();
  return (
    <Link href={href} asChild>
      <PressableScale
        accessibilityRole="link"
        style={{
          minHeight: layout.controlHeight,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{label}</Text>
      </PressableScale>
    </Link>
  );
}
