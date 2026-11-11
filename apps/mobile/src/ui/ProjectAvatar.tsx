import { Text, View } from "react-native";

import { projectColor, projectInitials } from "../projects/identity";
import { useTheme } from "../theme/useTheme";

/** Decoration only: the project's name is always shown next to it. */
export function ProjectAvatar({ id, name }: { id: string; name: string }) {
  const { typography, radius, identity, onFixed } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: identity.avatarSize,
        height: identity.avatarSize,
        borderRadius: radius.avatar,
        backgroundColor: projectColor(id),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={[typography.bodyStrong, { color: onFixed }]} maxFontSizeMultiplier={1.2}>
        {projectInitials(name)}
      </Text>
    </View>
  );
}
