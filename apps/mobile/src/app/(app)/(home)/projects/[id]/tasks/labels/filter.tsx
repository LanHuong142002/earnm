import { useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DEFAULT_FILTERS } from "../../../../../../../tasks/filters";
import { toggleFilterLabel } from "../../../../../../../tasks/labelSheets";
import { LabelChip } from "../../../../../../../tasks/LabelChip";
import { SheetFrame, SheetLink } from "../../../../../../../tasks/SheetFrame";
import { useTasks } from "../../../../../../../tasks/TasksProvider";
import { useCloseWhenGone, useLabelScreen } from "../../../../../../../tasks/useLabelScreen";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Button } from "../../../../../../../ui/Button";
import { Card } from "../../../../../../../ui/Card";
import { ChoiceRow } from "../../../../../../../ui/ChoiceRow";

/** Label filter sheet (mockup 1b): each tap changes the project's saved filter at once. */
export default function LabelFilterSheet() {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { filtersFor, setFilters } = useTasks();
  const { project, ready, labels, gone, focused, router } = useLabelScreen(id);
  useCloseWhenGone(gone, focused, null, () => router.back());

  const close = () => router.back();
  if (!project || !ready) return <SheetFrame title={t("tasks.labels.filterTitle")}><View /></SheetFrame>;

  const filters = filtersFor(project.id);
  // Only labels that still exist count as chosen.
  const chosen = filters.labelIds.filter((x) => labels.some((l) => l.id === x));
  const toggle = (labelId: string) => void setFilters(project.id, { ...filters, labelIds: toggleFilterLabel(chosen, labelId) });

  return (
    <SheetFrame title={t("tasks.labels.filterTitle")} right={<SheetLink label={t("tasks.labels.done")} onPress={close} strong />}>
      <Text style={[typography.label, { color: colors.textSecondary }]}>{t("tasks.labels.filterCaption")}</Text>
      {labels.length === 0 ? (
        <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.labels.manageEmpty")}</Text>
      ) : (
        <Card>
          {labels.map((label, index) => (
            <ChoiceRow
              key={label.id}
              role="checkbox"
              label={label.name}
              selected={chosen.includes(label.id)}
              divider={index > 0}
              onPress={() => toggle(label.id)}
              content={<LabelChip label={label} size="md" />}
            />
          ))}
        </Card>
      )}
      <View style={{ gap: spacing[0] }}>
        <Button
          label={t("tasks.labels.clearAll")}
          variant="secondary"
          disabled={chosen.length === 0}
          onPress={() => void setFilters(project.id, { ...filters, labelIds: DEFAULT_FILTERS.labelIds })}
        />
      </View>
    </SheetFrame>
  );
}
