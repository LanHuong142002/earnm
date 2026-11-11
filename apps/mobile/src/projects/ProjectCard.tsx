import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { PressableScale } from "../ui/PressableScale";
import type { Project, ProjectRole } from "./api";

const COVER_HEIGHT = 92;
const ICON_SIZE = 30;

/** The top area of a project card: the project icon on `tile`, with the currency pill top-right. */
export function ProjectCover({ currency, pillLabel }: { currency: string; pillLabel?: string }) {
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <View
      style={{
        height: COVER_HEIGHT,
        backgroundColor: colors.tile,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Ionicons name="storefront-outline" size={ICON_SIZE} color={colors.accent} />
      </View>
      <View
        style={{
          position: "absolute",
          top: spacing[1],
          right: spacing[1],
          backgroundColor: colors.surface,
          borderRadius: radius.pill,
          paddingVertical: spacing[0],
          paddingHorizontal: spacing[1],
        }}
      >
        <Text
          accessibilityLabel={pillLabel}
          style={[typography.caption, { fontFamily: typography.label.fontFamily, color: colors.text }]}
        >
          {currency}
        </Text>
      </View>
    </View>
  );
}

export function roleKey(role: ProjectRole): "projects.roleOwner" | "projects.roleMember" {
  return role === "owner" ? "projects.roleOwner" : "projects.roleMember";
}

export function ProjectCard({ project, onPress }: { project: Project; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const role = t(roleKey(project.role));
  const description = project.description.trim();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("projects.cardLabel", { name: project.name, currency: project.currency, role })}
      onPress={onPress}
    >
      <Card flush>
        <ProjectCover currency={project.currency} />
        <View style={{ padding: spacing[2], gap: spacing[0] }}>
          <Text style={[typography.bodyStrong, { color: colors.text }]} numberOfLines={1}>
            {project.name}
          </Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]} numberOfLines={1}>
            {description !== "" ? `${role} · ${description}` : role}
          </Text>
        </View>
      </Card>
    </PressableScale>
  );
}
