import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { toggleTaskLabel } from "../../../../../../../tasks/labelSheets";
import { LabelChip } from "../../../../../../../tasks/LabelChip";
import { SheetFrame, SheetLink } from "../../../../../../../tasks/SheetFrame";
import { useTasks } from "../../../../../../../tasks/TasksProvider";
import { useCloseWhenGone, useLabelScreen } from "../../../../../../../tasks/useLabelScreen";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Button } from "../../../../../../../ui/Button";
import { Card } from "../../../../../../../ui/Card";
import { ChoiceRow } from "../../../../../../../ui/ChoiceRow";
import { ErrorText } from "../../../../../../../ui/ErrorText";

/** Put labels on a task (mockups 3a, 3d): a tap saves at once, up to 10 per task. */
export default function PickLabelsSheet() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  const { setTaskLabels } = useTasks();
  const { project, ready, labels, task, gone, focused, router } = useLabelScreen(id, { taskId });
  const [error, setError] = useState<string | null>(null);
  useCloseWhenGone(gone, focused, null, () => router.back());

  const title = t("tasks.labels.pickTitle");
  if (!project || !ready || !task) {
    return (
      <SheetFrame title={title}>
        <View />
      </SheetFrame>
    );
  }

  const selected = task.labelIds.filter((x) => labels.some((l) => l.id === x));
  const toggle = (labelId: string) => {
    // The full set, including ids this phone has not fetched yet, so a toggle never drops them.
    const next = toggleTaskLabel(task.labelIds, labelId);
    if (next.limit) {
      setError("tasks.errors.labelsPerTaskLimit");
      return;
    }
    setError(null);
    void setTaskLabels(project.id, task.id, next.ids).then((r) => {
      if (!r.ok) setError(r.error);
    });
  };
  const openNew = () =>
    router.push({ pathname: "/projects/[id]/tasks/labels/form", params: { id: project.id, taskId: task.id } });

  return (
    <SheetFrame title={title} right={<SheetLink label={t("tasks.labels.done")} onPress={() => router.back()} strong />}>
      {labels.length === 0 ? (
        <>
          <View style={{ gap: spacing[0] }}>
            <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
              {t("tasks.labels.pickEmptyTitle")}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.labels.pickEmptyBody")}</Text>
          </View>
          <Button label={t("tasks.labels.newLabel")} variant="secondary" onPress={openNew} />
        </>
      ) : (
        <>
          <Card>
            {labels.map((label, index) => (
              <ChoiceRow
                key={label.id}
                role="checkbox"
                label={label.name}
                selected={selected.includes(label.id)}
                divider={index > 0}
                onPress={() => toggle(label.id)}
                content={<LabelChip label={label} size="md" />}
              />
            ))}
          </Card>
          {error ? <ErrorText message={t(error)} /> : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <SheetLink label={t("tasks.labels.newLabel")} onPress={openNew} />
            <SheetLink
              label={t("tasks.labels.manage")}
              onPress={() => router.push({ pathname: "/projects/[id]/tasks/labels", params: { id: project.id } })}
            />
          </View>
        </>
      )}
    </SheetFrame>
  );
}
