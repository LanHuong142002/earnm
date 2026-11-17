import { useRouter } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTapOnce } from "../projects/useProjectNav";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { LabelChip } from "./LabelChip";
import { useTasks } from "./TasksProvider";

/**
 * The task's labels as chips with an "Edit" link, or "No labels yet" with "Add" (mockups 2a, 2e).
 * The whole row opens the label picker sheet for this task.
 */
export function LabelsField({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const once = useTapOnce();
  const { colors, typography, layout, spacing } = useTheme();
  const { tasksFor, labelsFor } = useTasks();
  const task = tasksFor(projectId).find((x) => x.id === taskId);
  const all = labelsFor(projectId);
  const labels = (task?.labelIds ?? []).flatMap((id) => all.find((l) => l.id === id) ?? []);
  const has = labels.length > 0;
  const open = () => once(() => router.push({ pathname: "/projects/[id]/tasks/labels/pick", params: { id: projectId, taskId } }));
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={
        has
          ? `${t("tasks.labelsField.a11y", { names: labels.map((l) => l.name).join(", ") })}. ${t("tasks.labelsField.editA11y")}`
          : `${t("tasks.labelsField.none")}. ${t("tasks.labelsField.addA11y")}`
      }
      onPress={open}
      style={{ minHeight: layout.controlHeight, flexDirection: "row", alignItems: "center", gap: spacing[1] }}
    >
      {has ? (
        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing[0], paddingVertical: spacing[0] }}>
          {labels.map((label) => (
            <LabelChip key={label.id} label={label} size="md" />
          ))}
        </View>
      ) : (
        <Text style={[typography.body, { flex: 1, color: colors.textSecondary }]}>{t("tasks.labelsField.none")}</Text>
      )}
      <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>
        {has ? t("tasks.labelsField.edit") : t("tasks.labelsField.add")}
      </Text>
    </PressableScale>
  );
}
