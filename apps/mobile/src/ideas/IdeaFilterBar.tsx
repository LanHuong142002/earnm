import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { toggleFilterLabel } from "../tasks/labelSheets";
import type { Label } from "../tasks/types";
import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import type { IdeaFilters, IdeaStatusFilter } from "./filters";
import { LabelToggle } from "./LabelToggle";

const STATUS_CHOICES: readonly IdeaStatusFilter[] = ["all", "new", "considering", "accepted"];
const FILTER_KEY: Record<IdeaStatusFilter, string> = {
  all: "ideas.filterAll",
  new: "ideas.filterNew",
  considering: "ideas.filterConsidering",
  accepted: "ideas.filterAccepted",
};

/**
 * The status pills and the project's labels as the filter of the ideas board (spec R17). The chosen pill and
 * the chosen labels are shown by highlight only, with no tick marks (R21). Every chosen condition holds together.
 */
export function IdeaFilterBar({
  filters,
  labels,
  onChange,
}: {
  filters: IdeaFilters;
  labels: readonly Label[];
  onChange: (next: IdeaFilters) => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout } = useTheme();
  // Only labels that still exist count as chosen.
  const chosen = filters.labelIds.filter((id) => labels.some((l) => l.id === id));
  return (
    <View style={{ gap: spacing[1] }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("ideas.filterStatusGroup")}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[1] }}
      >
        {STATUS_CHOICES.map((status) => {
          const selected = filters.status === status;
          return (
            <PressableScale
              key={status}
              accessibilityRole="radio"
              accessibilityLabel={t(FILTER_KEY[status])}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange({ ...filters, status })}
              style={{
                minHeight: layout.controlHeight,
                justifyContent: "center",
                paddingHorizontal: spacing[2],
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: selected ? colors.accent : colors.field,
                backgroundColor: selected ? colors.tile : colors.field,
              }}
            >
              <Text
                style={[selected ? typography.bodyStrong : typography.body, { color: selected ? colors.accentStrong : colors.text }]}
                numberOfLines={1}
              >
                {t(FILTER_KEY[status])}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      {labels.length > 0 ? (
        <View accessibilityLabel={t("ideas.filterLabelsGroup")} style={{ flexDirection: "row", flexWrap: "wrap", columnGap: spacing[0] }}>
          {labels.map((label) => (
            <LabelToggle
              key={label.id}
              label={label}
              selected={chosen.includes(label.id)}
              onPress={() => onChange({ ...filters, labelIds: toggleFilterLabel(chosen, label.id) })}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
