import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { ChoiceRow } from "../ui/ChoiceRow";
import { ErrorText } from "../ui/ErrorText";
import { PressableScale } from "../ui/PressableScale";
import { assigneeSummary } from "./assignees";
import type { TaskAssignee } from "./types";

/**
 * Who the task is for: a field showing the chosen first names that opens the project's members
 * right under it. A chosen person has a check mark (never colour alone).
 */
export function AssigneeField({
  people,
  selectedIds,
  onToggle,
  error,
  disabled = false,
}: {
  people: TaskAssignee[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  error?: string | null;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, radius, spacing, iconSize } = useTheme();
  const [open, setOpen] = useState(false);
  const summary = assigneeSummary(selectedIds, people);
  // Chosen people missing from the list (never fetched) still count.
  const unknown = selectedIds.length - people.filter((p) => selectedIds.includes(p.id)).length;
  const shown = summary !== "" ? summary : unknown > 0 ? t("tasks.moreAssignees", { count: unknown }) : t("tasks.assigneesNone");
  const hasChosen = selectedIds.length > 0;
  const invalid = Boolean(error);

  return (
    <View style={{ gap: spacing[0] }}>
      <Text style={[typography.label, { color: colors.text }]}>{t("tasks.assigneesLabel")}</Text>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t("tasks.assigneesLabel")}
        accessibilityValue={{ text: shown }}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => setOpen((o) => !o)}
        style={{
          minHeight: layout.controlHeight,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          paddingHorizontal: spacing[2],
          borderRadius: radius.field,
          borderWidth: 1.5,
          borderColor: invalid ? colors.danger : "transparent",
          backgroundColor: invalid ? colors.dangerBg : colors.field,
        }}
      >
        <Ionicons name="people-outline" size={iconSize.sm} color={colors.placeholder} />
        <Text style={[typography.body, { flex: 1, color: hasChosen ? colors.text : colors.placeholder }]}>{shown}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={iconSize.sm} color={colors.textSecondary} />
      </PressableScale>
      {open ? (
        <Card>
          <View>
            {people.map((person, i) => (
              <ChoiceRow
                key={person.id}
                label={person.displayName}
                selected={selectedIds.includes(person.id)}
                divider={i > 0}
                onPress={() => onToggle(person.id)}
              />
            ))}
          </View>
        </Card>
      ) : null}
      {error ? <ErrorText message={error} /> : null}
    </View>
  );
}
