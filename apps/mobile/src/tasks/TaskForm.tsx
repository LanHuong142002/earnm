import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ChoiceRow } from "../ui/ChoiceRow";
import { Enter } from "../ui/Enter";
import { ErrorText } from "../ui/ErrorText";
import { Screen } from "../ui/Screen";
import { TextField } from "../ui/TextField";
import { DueField } from "./DueField";
import { clearDay, inputFromForm, setDay, setTime, clearTime, type TaskForm as TaskFormValues } from "./formState";
import type { TaskMutationResult } from "./TasksProvider";
import { TASK_STATUSES } from "./types";
import { validateTaskInput, type TaskInputErrors } from "./validate";

/** Shared by New task and Edit task. `onSubmit` returns the provider's result. */
export function TaskForm({
  initial,
  submitLabel,
  onSubmit,
  extra,
}: {
  initial: TaskFormValues;
  submitLabel: string;
  /** `opened` is what the form started with, so callers can send only what the person changed. */
  onSubmit: (form: TaskFormValues, opened: TaskFormValues) => Promise<TaskMutationResult<object>>;
  /** Set-apart section at the end of the scrolling form (not the footer), e.g. a delete button. */
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  // The Home stack header sits above this screen; the keyboard overlap must account for it.
  const headerHeight = useHeaderHeight();
  const opened = useRef(initial).current;
  const [form, setForm] = useState<TaskFormValues>(initial);
  const [errors, setErrors] = useState<TaskInputErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const descriptionRef = useRef<ComponentRef<typeof TextInput>>(null);

  const message = (key?: TaskInputErrors[keyof TaskInputErrors]) => (key ? t(key) : null);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const checked = validateTaskInput(inputFromForm(form));
      if (!checked.ok) {
        setErrors(checked.errors);
        return;
      }
      const result = await onSubmit(form, opened);
      if (!result.ok) {
        // Empty errors means the change could not be attributed yet (not ready): a general message.
        if (Object.keys(result.errors).length === 0) setFormError(t("errors.generic"));
        else setErrors(result.errors);
      }
    } catch {
      setFormError(t("errors.generic"));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen
      edges={[]}
      keyboardOffset={headerHeight}
      footer={<Button label={submitLabel} loading={busy} onPress={submit} />}
    >
      <Enter index={0}>
        <View style={{ gap: spacing[2] }}>
          <TextField
            label={t("tasks.titleLabel")}
            icon="checkbox-outline"
            error={message(errors.title)}
            value={form.title}
            onChangeText={(title) => setForm((f) => ({ ...f, title }))}
            autoCapitalize="sentences"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => descriptionRef.current?.focus()}
            editable={!busy}
          />
          <TextField
            label={t("tasks.descriptionOptional")}
            icon="document-text-outline"
            error={message(errors.description)}
            value={form.description}
            onChangeText={(description) => setForm((f) => ({ ...f, description }))}
            multiline
            inputRef={descriptionRef}
            returnKeyType="done"
            submitBehavior="blurAndSubmit"
            onSubmitEditing={() => void submit()}
            editable={!busy}
          />
          <View style={{ gap: spacing[0] }}>
            <Text style={[typography.label, { color: colors.text }]}>{t("tasks.statusLabel")}</Text>
            <Card>
              <View accessibilityRole="radiogroup">
                {TASK_STATUSES.map((status, i) => (
                  <ChoiceRow
                    key={status}
                    label={t(`tasks.status.${status}`)}
                    selected={form.status === status}
                    divider={i > 0}
                    onPress={() => setForm((f) => ({ ...f, status }))}
                  />
                ))}
              </View>
            </Card>
            {errors.status ? <ErrorText message={t(errors.status)} /> : null}
          </View>
          <DueField
            dueDate={form.dueDate}
            dueTime={form.dueTime}
            onChangeDay={(day) => setForm((f) => (day === null ? clearDay(f) : setDay(f, day)))}
            onChangeTime={(time) => setForm((f) => (time === null ? clearTime(f) : setTime(f, time)))}
            dateError={message(errors.dueDate)}
            timeError={message(errors.dueTime)}
            disabled={busy}
          />
          {/* Task 10: the assignee field goes here (errors.assignees, form.assigneeIds). */}
          {formError ? <ErrorText message={formError} /> : null}
        </View>
      </Enter>
      {extra ? (
        <Enter index={1}>
          {/* Set apart from the form, with room below, so it can't be hit when reaching for Save. */}
          <View
            style={{
              marginTop: spacing[6],
              marginBottom: spacing[6],
              paddingTop: spacing[5],
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            {extra}
          </View>
        </Enter>
      ) : null}
    </Screen>
  );
}
