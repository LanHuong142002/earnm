import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { PressableScale } from "../ui/PressableScale";
import type { TaskFilters } from "./filters";
import { labelSummary } from "./labelDisplay";
import type { Label } from "./types";

const STATUS_CHOICES: readonly TaskFilters["status"][] = ["all", "todo", "doing", "done"];

type SwitchKey = "mine" | "onlyMe" | "dueSoon";
const SWITCHES: readonly { key: SwitchKey; label: string }[] = [
  { key: "mine", label: "tasks.filterAssignedToMe" },
  { key: "onlyMe", label: "tasks.filterOnlyMe" },
  { key: "dueSoon", label: "tasks.filterDueSoon" },
];

/** Status pills (a check on the selected one) and three switches. Every chosen condition holds together (spec R24). */
export function FilterBar({
  filters,
  onChange,
  projectId,
  labels = [],
}: {
  filters: TaskFilters;
  onChange: (next: TaskFilters) => void;
  projectId: string;
  /** The project's labels, to name the chosen ones in the Labels row. */
  labels?: readonly Label[];
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const summary = labelSummary(filters.labelIds, labels) ?? t("tasks.labels.all");
  const { colors, typography, radius, spacing, layout, iconSize } = useTheme();
  const statusLabel = (status: TaskFilters["status"]) =>
    status === "all" ? t("tasks.statusAll") : t(`tasks.status.${status}`);

  return (
    <View style={{ gap: spacing[1] }}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t("tasks.filterStatusGroup")}
        style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[1] }}
      >
        {STATUS_CHOICES.map((status) => {
          const selected = filters.status === status;
          return (
            <PressableScale
              key={status}
              accessibilityRole="radio"
              accessibilityLabel={statusLabel(status)}
              accessibilityState={{ selected, checked: selected }}
              onPress={() => onChange({ ...filters, status })}
              style={{
                minHeight: layout.controlHeight,
                flexDirection: "row",
                alignItems: "center",
                gap: spacing[0],
                paddingHorizontal: spacing[2],
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: selected ? colors.tileBorder : colors.field,
                backgroundColor: selected ? colors.tile : colors.field,
              }}
            >
              {selected ? <Ionicons name="checkmark" size={iconSize.sm} color={colors.accent} /> : null}
              <Text style={[selected ? typography.bodyStrong : typography.body, { color: colors.text }]} numberOfLines={1}>
                {statusLabel(status)}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      <Card>
        {SWITCHES.map(({ key, label }, index) => (
          <View
            key={key}
            style={{
              minHeight: layout.controlHeight,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: spacing[2],
              borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            }}
          >
            <Text style={[typography.body, { color: colors.text, flexShrink: 1 }]}>{t(label)}</Text>
            <Switch
              accessibilityLabel={t(label)}
              value={filters[key]}
              onValueChange={(value) => onChange({ ...filters, [key]: value })}
              trackColor={{ false: colors.field, true: colors.accentStrong }}
              thumbColor={colors.surface}
              ios_backgroundColor={colors.field}
            />
          </View>
        ))}
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t("tasks.labels.filterRowA11y", { value: summary })}
          onPress={() =>
            // The filter route is added with the label screens; typed loosely until then.
            router.push({ pathname: "/projects/[id]/tasks/labels/filter", params: { id: projectId } } as never)
          }
          style={{
            minHeight: layout.controlHeight,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: spacing[2],
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
          }}
        >
          <Text style={[typography.body, { color: colors.text }]}>{t("tasks.labels.filterRow")}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0], flexShrink: 1 }}>
            <Text style={[typography.bodyStrong, { color: colors.accentStrong, flexShrink: 1 }]} numberOfLines={1}>
              {summary}
            </Text>
            <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textSecondary} />
          </View>
        </PressableScale>
      </Card>
    </View>
  );
}
