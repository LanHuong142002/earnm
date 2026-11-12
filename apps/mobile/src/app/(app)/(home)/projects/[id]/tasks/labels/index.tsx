import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { OfflineNote } from "../../../../../../../projects/OfflineNote";
import { LabelChip } from "../../../../../../../tasks/LabelChip";
import { canDeleteLabel } from "../../../../../../../tasks/permissions";
import { TaskRejectedNotice } from "../../../../../../../tasks/TaskRejectedNotice";
import { useCloseWhenGone, useLabelScreen } from "../../../../../../../tasks/useLabelScreen";
import { LABELS_PER_PROJECT_MAX } from "../../../../../../../tasks/validate";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Button } from "../../../../../../../ui/Button";
import { Card } from "../../../../../../../ui/Card";
import { PressableScale } from "../../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../../ui/Screen";

/** The project's labels (mockup 3e): tap one to rename or recolour it; only an Owner can delete. */
export default function LabelsScreen() {
  const { t } = useTranslation();
  const { colors, typography, spacing, layout, iconSize } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { project, ready, labels, role, gone, focused, router } = useLabelScreen(id);
  useCloseWhenGone(gone, focused, null, () => router.back());

  if (!project || !ready) return <Screen edges={[]}>{null}</Screen>;

  const full = labels.length >= LABELS_PER_PROJECT_MAX;
  const caption = t(canDeleteLabel(role) ? "tasks.labels.manageCaptionOwner" : "tasks.labels.manageCaptionMember", {
    count: labels.length,
  });
  const openForm = (labelId?: string) =>
    router.push({
      pathname: "/projects/[id]/tasks/labels/form",
      params: labelId ? { id: project.id, labelId } : { id: project.id },
    });

  return (
    <Screen edges={[]}>
      <OfflineNote />
      <TaskRejectedNotice />
      {labels.length === 0 ? (
        <View style={{ gap: spacing[0] }}>
          <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
            {t("tasks.labels.pickEmptyTitle")}
          </Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.labels.pickEmptyBody")}</Text>
        </View>
      ) : (
        <Card>
          {labels.map((label, index) => (
            <PressableScale
              key={label.id}
              accessibilityRole="button"
              accessibilityLabel={t("tasks.labels.rowA11y", { name: label.name })}
              onPress={() => openForm(label.id)}
              style={{
                minHeight: layout.controlHeight,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: spacing[1],
                borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ flex: 1, alignItems: "flex-start" }}>
                <LabelChip label={label} size="md" />
              </View>
              <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
            </PressableScale>
          ))}
        </Card>
      )}
      <Text style={[typography.label, { color: colors.textSecondary }]}>{caption}</Text>
      {full ? <Text style={[typography.label, { color: colors.textSecondary }]}>{t("tasks.labels.limitReached")}</Text> : null}
      <Button label={t("tasks.labels.newLabel")} variant="secondary" disabled={full} onPress={() => openForm()} />
    </Screen>
  );
}
