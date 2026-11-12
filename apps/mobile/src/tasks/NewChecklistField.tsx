import { useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { ErrorText } from "../ui/ErrorText";
import { InlineInput } from "./InlineInput";
import { useTasks } from "./TasksProvider";
import { validateChecklistName } from "./validate";

/** The name field for a new checklist (mockup 2f). Return creates it; blur with nothing typed cancels. */
export function NewChecklistField({
  projectId,
  taskId,
  onCreated,
  onCancel,
}: {
  projectId: string;
  taskId: string;
  /** Called with the new checklist's id, so its "add item" input can open. */
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  const { addChecklist } = useTasks();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  async function create() {
    if (busy.current) return;
    const checked = validateChecklistName(name);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    busy.current = true;
    try {
      const result = await addChecklist(projectId, taskId, checked.value);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onCreated(result.id);
    } finally {
      busy.current = false;
    }
  }

  return (
    <Card>
      <View style={{ gap: spacing[0] }}>
        <Text style={[typography.label, { color: colors.text }]}>{t("tasks.checklists.newName")}</Text>
        <View style={{ flexDirection: "row" }}>
          <InlineInput
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError(null);
            }}
            onSubmit={() => void create()}
            onBlur={() => {
              if (name.trim() === "" && !busy.current) onCancel();
            }}
            accessibilityLabel={t("tasks.checklists.newName")}
            invalid={error !== null}
          />
        </View>
        {error ? <ErrorText message={t(error)} /> : null}
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("tasks.checklists.newHint")}</Text>
      </View>
    </Card>
  );
}
