import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../../auth/AuthProvider";
import { RejectedNoticeBanner } from "../../../projects/RejectedNotice";
import { useProjects } from "../../../projects/ProjectsProvider";
import { useTapOnce } from "../../../projects/useProjectNav";
import { homeCard } from "../../../projects/routing";
import { useTheme } from "../../../theme/useTheme";
import { Enter } from "../../../ui/Enter";
import { PressableScale } from "../../../ui/PressableScale";
import { Screen } from "../../../ui/Screen";

type IconName = ComponentProps<typeof Ionicons>["name"];

function AreaTile({
  icon,
  label,
  onPress,
  comingSoon,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  comingSoon?: string;
}) {
  const { colors, typography, radius, spacing, tile, iconSize } = useTheme();
  const disabled = comingSoon !== undefined;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label}, ${comingSoon}` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        width: "48%",
        gap: spacing[1],
        padding: spacing[2],
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <View
        style={{
          width: tile.width,
          height: tile.height,
          borderRadius: radius.tile,
          backgroundColor: colors.tile,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={iconSize.md} color={colors.accentStrong} />
      </View>
      <View>
        <Text style={[typography.bodyStrong, { color: colors.text }]}>{label}</Text>
        {comingSoon ? (
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{comingSoon}</Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const once = useTapOnce();
  const { profileStatus } = useAuth();
  const { status, projects, currentProject, waitingCount } = useProjects();
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();

  const offline = status === "offline" || profileStatus === "offline";
  const card = homeCard(currentProject, status, projects.length);

  return (
    <Screen edges={[]}>
      {offline ? (
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("home.offline")}</Text>
      ) : null}
      {waitingCount > 0 ? (
        <Text style={[typography.label, { color: colors.textSecondary }]}>
          {t("projects.waiting", { count: waitingCount })}
        </Text>
      ) : null}
      <RejectedNoticeBanner />
      <Enter index={1}>
        {card === "loading" ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              height: layout.controlHeight * 2,
              borderRadius: radius.card,
              backgroundColor: colors.field,
            }}
          />
        ) : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={
              currentProject
                ? t("home.projectCardLabel", { name: currentProject.name, currency: currentProject.currency })
                : t("projects.emptyTitle")
            }
            onPress={() =>
              once(() =>
                currentProject
                  ? router.push({ pathname: "/projects/[id]", params: { id: currentProject.id } })
                  : router.push("/projects/new"),
              )
            }
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing[2],
              padding: spacing[3],
              minHeight: layout.controlHeight * 2,
              borderRadius: radius.card,
              backgroundColor: colors.tile,
            }}
          >
            <View style={{ flex: 1, gap: spacing[0] }}>
              <Text style={[typography.overline, { color: colors.accentStrong }]}>
                {currentProject ? t("home.currentProject") : t("home.noProject")}
              </Text>
              <Text style={[typography.screenTitle, { color: colors.text }]} numberOfLines={2}>
                {currentProject ? currentProject.name : t("projects.emptyTitle")}
              </Text>
              <Text style={[typography.body, { color: colors.textSecondary }]}>
                {currentProject
                  ? t("projects.currencyLine", { currency: currentProject.currency })
                  : t("projects.emptyBody")}
              </Text>
            </View>
            <Ionicons
              name={currentProject ? "chevron-forward" : "add-circle-outline"}
              size={iconSize.md}
              color={colors.accentStrong}
            />
          </PressableScale>
        )}
      </Enter>
      <Enter index={2}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing[2] }}>
          <AreaTile icon="folder-outline" label={t("home.areaProjects")} onPress={() => once(() => router.push("/projects"))} />
          <AreaTile icon="bulb-outline" label={t("home.areaIdeas")} comingSoon={t("home.comingSoon")} />
          <AreaTile icon="calendar-outline" label={t("home.areaSchedule")} comingSoon={t("home.comingSoon")} />
        </View>
      </Enter>
    </Screen>
  );
}
