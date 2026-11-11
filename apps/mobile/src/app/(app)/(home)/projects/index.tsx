import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { RejectedNoticeBanner } from "../../../../projects/RejectedNotice";
import { useProjects } from "../../../../projects/ProjectsProvider";
import { useTheme } from "../../../../theme/useTheme";
import { Button } from "../../../../ui/Button";
import { Card } from "../../../../ui/Card";
import { Enter } from "../../../../ui/Enter";
import { PressableScale } from "../../../../ui/PressableScale";
import { Screen } from "../../../../ui/Screen";

export default function ProjectsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, layout, radius, spacing, iconSize } = useTheme();
  const { status, projects, setCurrentProject, refresh } = useProjects();

  // R17: fetch the server's list every time this screen is shown.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  async function open(id: string) {
    await setCurrentProject(id);
    router.push({ pathname: "/projects/[id]", params: { id } });
  }

  const empty = projects.length === 0 && status !== "loading";

  return (
    <Screen edges={[]}>
      <RejectedNoticeBanner />
      {status === "offline" ? (
        <Text style={[typography.label, { color: colors.textSecondary }]}>{t("home.offline")}</Text>
      ) : null}
      {projects.length === 0 && status === "loading" ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            height: layout.controlHeight * 2,
            borderRadius: radius.card,
            backgroundColor: colors.field,
          }}
        />
      ) : null}
      {empty ? (
        <Enter index={0}>
          <View style={{ gap: spacing[0] }}>
            <Text
              accessibilityRole="header"
              style={[typography.sectionTitle, { color: colors.text }]}
            >
              {t("projects.emptyTitle")}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>
              {t("projects.emptyBody")}
            </Text>
          </View>
        </Enter>
      ) : null}
      {projects.length > 0 ? (
        <Enter index={0}>
          <Card>
            <View>
              {projects.map((p, i) => (
                <PressableScale
                  key={p.id}
                  accessibilityRole="button"
                  accessibilityLabel={
                    p.role === "member"
                      ? t("projects.rowLabelMember", { name: p.name, currency: p.currency })
                      : t("projects.rowLabel", { name: p.name, currency: p.currency })
                  }
                  onPress={() => void open(p.id)}
                  style={{
                    minHeight: layout.controlHeight,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: spacing[1],
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.bodyStrong, { color: colors.text }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={[typography.caption, { color: colors.textSecondary }]}>
                      {p.role === "member"
                        ? `${p.currency} · ${t("projects.roleMember")}`
                        : p.currency}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={iconSize.sm}
                    color={colors.textSecondary}
                  />
                </PressableScale>
              ))}
            </View>
          </Card>
        </Enter>
      ) : null}
      <Enter index={1}>
        <Button
          label={t("projects.newButton")}
          variant={empty ? "primary" : "secondary"}
          onPress={() => router.push("/projects/new")}
        />
      </Enter>
    </Screen>
  );
}
