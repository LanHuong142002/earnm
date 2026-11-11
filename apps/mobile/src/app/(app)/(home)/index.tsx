import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { OfflineNote } from "../../../projects/OfflineNote";
import { ProjectCard } from "../../../projects/ProjectCard";
import { RejectedNoticeBanner } from "../../../projects/RejectedNotice";
import { useProjects } from "../../../projects/ProjectsProvider";
import { useTapOnce } from "../../../projects/useProjectNav";
import { homeCard } from "../../../projects/routing";
import { useTheme } from "../../../theme/useTheme";
import { Enter } from "../../../ui/Enter";
import { PressableScale } from "../../../ui/PressableScale";
import { Screen } from "../../../ui/Screen";

// Home shows this many projects before "See all".
const HOME_PROJECT_LIMIT = 2;

type IconName = ComponentProps<typeof Ionicons>["name"];

// Three of these share one row equally; the box stays square.
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
  const { colors, typography, radius, spacing, iconSize, disabled: disabledStyle } = useTheme();
  const disabled = comingSoon !== undefined;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={disabled ? `${label}, ${comingSoon}` : label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ flex: 1, gap: spacing[1], opacity: disabled ? disabledStyle.opacity : 1 }}
    >
      <View
        style={{
          aspectRatio: 1,
          borderRadius: radius.tile,
          borderWidth: 1,
          borderColor: colors.tileBorder,
          backgroundColor: colors.tile,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={iconSize.lg} color={colors.accent} />
      </View>
      <View style={{ alignItems: "center" }}>
        <Text style={[typography.label, { color: colors.text, textAlign: "center" }]}>{label}</Text>
        {comingSoon ? (
          <Text style={[typography.caption, { color: colors.textSecondary, textAlign: "center" }]}>{comingSoon}</Text>
        ) : null}
      </View>
    </PressableScale>
  );
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const once = useTapOnce();
  const { status, projects, currentProject, waitingCount } = useProjects();
  const { colors, typography, radius, spacing, layout, iconSize, onFixed } = useTheme();

  const card = homeCard(currentProject, status, projects.length);
  // The current project first, then the rest in list order.
  const shown = [...projects]
    .sort((a, b) => Number(b.id === currentProject?.id) - Number(a.id === currentProject?.id))
    .slice(0, HOME_PROJECT_LIMIT);

  return (
    <Screen edges={[]}>
      <OfflineNote />
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
        ) : card === "offline" ? (
          <View
            style={{
              borderRadius: radius.card,
              backgroundColor: colors.tile,
              padding: spacing[3],
              minHeight: layout.controlHeight * 2,
              gap: spacing[0],
            }}
          >
            <Text style={[typography.screenTitle, { color: colors.text }]} numberOfLines={2}>
              {t("projects.offlineEmptyTitle")}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t("projects.offlineEmptyBody")}
            </Text>
          </View>
        ) : currentProject ? (
          <View
            style={{
              borderRadius: radius.tile,
              backgroundColor: colors.accentStrong,
              padding: spacing[3],
              gap: spacing[1],
              alignItems: "flex-start",
            }}
          >
            <Text style={[typography.overline, { color: onFixed }]}>{t("home.currentProject")}</Text>
            <Text style={[typography.screenTitle, { color: onFixed }]} numberOfLines={2}>
              {currentProject.name}
            </Text>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t("home.openProjectLabel", { name: currentProject.name })}
              onPress={() =>
                once(() => router.push({ pathname: "/projects/[id]", params: { id: currentProject.id } }))
              }
              style={{
                minHeight: layout.controlHeight,
                justifyContent: "center",
                paddingHorizontal: spacing[3],
                borderRadius: radius.button,
                backgroundColor: onFixed,
              }}
            >
              <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("home.openProject")}</Text>
            </PressableScale>
          </View>
        ) : (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={card === "choose" ? t("home.chooseTitle") : t("projects.emptyTitle")}
            onPress={() => once(() => (card === "choose" ? router.push("/projects") : router.push("/projects/new")))}
            style={{ borderRadius: radius.card, overflow: "hidden", backgroundColor: colors.tile }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing[2],
                padding: spacing[3],
                minHeight: layout.controlHeight * 2,
              }}
            >
              <View style={{ flex: 1, gap: spacing[0] }}>
                <Text style={[typography.overline, { color: colors.accentStrong }]}>{t("home.noProject")}</Text>
                <Text style={[typography.screenTitle, { color: colors.text }]} numberOfLines={2}>
                  {card === "choose" ? t("home.chooseTitle") : t("projects.emptyTitle")}
                </Text>
                <Text style={[typography.body, { color: colors.textSecondary }]}>
                  {card === "choose" ? t("home.chooseBody") : t("projects.emptyBody")}
                </Text>
              </View>
              <Ionicons
                name={card === "choose" ? "chevron-forward" : "add-circle-outline"}
                size={iconSize.md}
                color={colors.accentStrong}
              />
            </View>
          </PressableScale>
        )}
      </Enter>
      <Enter index={2}>
        <View style={{ flexDirection: "row", gap: spacing[2] }}>
          <AreaTile icon="folder-outline" label={t("home.areaProjects")} onPress={() => once(() => router.push("/projects"))} />
          <AreaTile icon="bulb-outline" label={t("home.areaIdeas")} comingSoon={t("home.comingSoon")} />
          <AreaTile icon="calendar-outline" label={t("home.areaSchedule")} comingSoon={t("home.comingSoon")} />
        </View>
      </Enter>
      {shown.length > 0 ? (
        <Enter index={3}>
          <View style={{ gap: spacing[1] }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
                {t("home.yourProjects")}
              </Text>
              <PressableScale
                accessibilityRole="link"
                onPress={() => once(() => router.push("/projects"))}
                style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingLeft: spacing[2] }}
              >
                <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("home.seeAll")}</Text>
              </PressableScale>
            </View>
            <View style={{ gap: spacing[2] }}>
              {shown.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onPress={() => once(() => router.push({ pathname: "/projects/[id]", params: { id: p.id } }))}
                />
              ))}
            </View>
          </View>
        </Enter>
      ) : null}
    </Screen>
  );
}
