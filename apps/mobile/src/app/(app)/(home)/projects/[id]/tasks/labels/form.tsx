import { useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { Alert, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ColourSwatches } from "../../../../../../../tasks/ColourSwatches";
import { LabelChip } from "../../../../../../../tasks/LabelChip";
import { labelFormState } from "../../../../../../../tasks/labelSheets";
import { canDeleteLabel } from "../../../../../../../tasks/permissions";
import { SheetFrame, SheetLink } from "../../../../../../../tasks/SheetFrame";
import { useTasks } from "../../../../../../../tasks/TasksProvider";
import { useCloseWhenGone, useLabelScreen } from "../../../../../../../tasks/useLabelScreen";
import { LABELS_PER_TASK_MAX } from "../../../../../../../tasks/validate";
import type { LabelColour } from "../../../../../../../theme/tokens";
import { useTheme } from "../../../../../../../theme/useTheme";
import { Button } from "../../../../../../../ui/Button";
import { TextField } from "../../../../../../../ui/TextField";

/** New label (from the picker, with `taskId`, it goes on that task) or edit one (`labelId`). Mockups 3b, 3c, 3f, 3g. */
export default function LabelFormSheet() {
  const { t } = useTranslation();
  const { colors, spacing } = useTheme();
  const { id, taskId, labelId } = useLocalSearchParams<{ id: string; taskId?: string; labelId?: string }>();
  const { createLabel, updateLabel, deleteLabel, setTaskLabels } = useTasks();
  const { project, ready, labels, label, role, gone, focused, router } = useLabelScreen(id, { labelId });
  const { tasksFor } = useTasks();
  const editing = labelId !== undefined;

  // Typed values start from the label being edited; null means "not touched yet".
  const [nameInput, setNameInput] = useState<string | null>(null);
  const [colourInput, setColourInput] = useState<LabelColour | null>(null);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Held while this sheet closes itself, so the "label is gone" close does not fire a second time.
  const closing = useRef(false);
  useCloseWhenGone(gone, focused, closing, () => router.back());

  const title = t(editing ? "tasks.labels.editTitle" : "tasks.labels.newTitle");
  const cancel = <SheetLink label={t("common.cancel")} onPress={() => router.back()} />;
  if (!project || !ready || (editing && !label)) {
    return (
      <SheetFrame title={title} left={cancel}>
        <View />
      </SheetFrame>
    );
  }

  const name = nameInput ?? label?.name ?? "";
  const colour: LabelColour = colourInput ?? label?.colour ?? "gray";
  const form = labelFormState(name, labels, labelId, touched);
  const errorText = form.error ? t(form.error, { name: name.trim() }) : serverError ? t(serverError) : null;
  const unchanged = editing && label !== null && form.name === label.name && colour === label.colour;

  const close = () => {
    closing.current = true;
    router.back();
  };

  const save = () => {
    const validName = form.name;
    if (!form.valid || validName === null || saving) return;
    setSaving(true);
    setServerError(null);
    void (async () => {
      try {
        if (editing && labelId) {
          const edit = {
            ...(validName !== label?.name ? { name: validName } : {}),
            ...(colour !== label?.colour ? { colour } : {}),
          };
          const result = await updateLabel(project.id, labelId, edit);
          if (!result.ok) {
            setServerError(result.error);
            setSaving(false);
            return;
          }
        } else {
          const result = await createLabel(project.id, validName, colour);
          if (!result.ok) {
            setServerError(result.error);
            setSaving(false);
            return;
          }
          // From the picker: the new label goes on that task too, as long as it has room.
          const task = taskId ? (tasksFor(project.id).find((x) => x.id === taskId) ?? null) : null;
          if (task) {
            if (task.labelIds.length >= LABELS_PER_TASK_MAX) Alert.alert(t("tasks.labels.addedToTask"));
            else await setTaskLabels(project.id, task.id, [...task.labelIds, result.id]);
          }
        }
        close();
      } catch {
        setSaving(false);
        setServerError("errors.generic");
      }
    })();
  };

  const confirmDelete = () => {
    if (!label) return;
    Alert.alert(t("tasks.labels.deleteTitle", { name: label.name }), t("tasks.labels.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("tasks.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          closing.current = true;
          void deleteLabel(project.id, label.id)
            .then(() => router.back())
            .catch(() => {
              closing.current = false;
              Alert.alert(t("errors.generic"));
            });
        },
      },
    ]);
  };

  return (
    <SheetFrame title={title} left={cancel}>
      <View accessibilityLabel={t("tasks.labels.preview")} style={{ alignItems: "center", minHeight: spacing[4] }}>
        {form.name ? <LabelChip label={{ name: form.name, colour }} size="md" /> : null}
      </View>
      <TextField
        label={t("tasks.labels.nameLabel")}
        icon="pricetag-outline"
        value={name}
        onChangeText={(v) => {
          setNameInput(v);
          setTouched(true);
          setServerError(null);
        }}
        error={errorText}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={save}
      />
      <ColourSwatches value={colour} onChange={setColourInput} />
      <Button
        label={t(editing ? "tasks.labels.save" : "tasks.labels.create")}
        loading={saving}
        disabled={!form.valid || unchanged}
        onPress={save}
      />
      {editing && canDeleteLabel(role) ? (
        <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing[2] }}>
          <Button label={t("tasks.labels.delete")} variant="danger" onPress={confirmDelete} />
        </View>
      ) : null}
    </SheetFrame>
  );
}
