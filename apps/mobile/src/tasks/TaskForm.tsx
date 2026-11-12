import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../auth/AuthProvider";
import { useMembers } from "../members/useMembers";
import { useTheme } from "../theme/useTheme";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ChoiceRow } from "../ui/ChoiceRow";
import { Enter } from "../ui/Enter";
import { ErrorText } from "../ui/ErrorText";
import { Screen } from "../ui/Screen";
import { TextField } from "../ui/TextField";
import { AssigneeField } from "./AssigneeField";
import { buildAssigneeOptions, toggleAssignee } from "./assignees";
import { DueField } from "./DueField";
import { dueChangeError } from "./dueRules";
import { clearDay, inputFromForm, setDay, setTime, clearTime, type TaskForm as TaskFormValues } from "./formState";
import { deriveMembers } from "./localChange";
import { useTasks, type TaskMutationResult } from "./TasksProvider";
import { TASK_STATUSES } from "./types";
import { validateTaskInput, type TaskInputErrors } from "./validate";

/** Shared by New task and Edit task. `onSubmit` returns the provider's result. */
export function TaskForm({
  projectId,
  initial,
  submitLabel,
  onSubmit,
  extra,
  showStatus = true,
}: {
  /** The project whose members can be chosen. */
  projectId: string;
  initial: TaskFormValues;
  submitLabel: string;
  /** `opened` is what the form started with, so callers can send only what the person changed. */
  onSubmit: (form: TaskFormValues, opened: TaskFormValues) => Promise<TaskMutationResult<object>>;
  /** Set-apart section at the end of the scrolling form (not the footer), e.g. a delete button. */
  extra?: ReactNode;
  /** Edit shows the status choices; a new task is always To do, so New task hides them. */
  showStatus?: boolean;
}) {
  const { t } = useTranslation();
  const { colors, typography, spacing } = useTheme();
  // The Home stack header sits above this screen; the keyboard overlap must account for it.
  const headerHeight = useHeaderHeight();
  const { tasksFor } = useTasks();
  // The saved identity counts while the profile is offline, so "me" is always in the picker.
  const { identity } = useAuth();
  // The project's current members, from #5's cache and refreshed when the form opens (R27).
  const { members } = useMembers(projectId);
  const opened = useRef(initial).current;
  const [form, setForm] = useState<TaskFormValues>(initial);
  const [errors, setErrors] = useState<TaskInputErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const descriptionRef = useRef<ComponentRef<typeof TextInput>>(null);

  const me = identity ? { id: identity.id, displayName: identity.displayName } : null;
  const known = deriveMembers(me, tasksFor(projectId), []);
  const options = buildAssigneeOptions({
    members,
    known,
    selectedIds: form.assigneeIds,
    me,
  });

  function toggle(id: string) {
    const former = options.find((o) => o.id === id)?.former ?? false;
    const next = toggleAssignee(form.assigneeIds, id, !former);
    setForm((f) => ({ ...f, assigneeIds: next.ids }));
    setErrors((e) => ({
      ...e,
      assignees: next.tooMany ? "tasks.errors.assigneesTooMany" : undefined,
    }));
  }

  const message = (key?: TaskInputErrors[keyof TaskInputErrors]) => (key ? t(key) : null);

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setErrors({});
    setFormError(null);
    try {
      const checked = validateTaskInput(inputFromForm(form));
      // A past day or time is refused only when the person set or changed it (an overdue task saves as is).
      const pastKey = dueChangeError(opened, form, new Date());
      const dueErrors: TaskInputErrors =
        pastKey === "tasks.errors.dueDatePast" ? { dueDate: pastKey } : pastKey ? { dueTime: pastKey } : {};
      if (!checked.ok || pastKey) {
        setErrors({ ...(checked.ok ? {} : checked.errors), ...dueErrors });
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
            // Return adds a line; the Save button below submits.
            submitBehavior="newline"
            editable={!busy}
          />
          {showStatus ? (
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
          ) : null}
          <DueField
            dueDate={form.dueDate}
            dueTime={form.dueTime}
            onChangeDay={(day) => setForm((f) => (day === null ? clearDay(f) : setDay(f, day)))}
            onChangeTime={(time) => setForm((f) => (time === null ? clearTime(f) : setTime(f, time)))}
            dateError={message(errors.dueDate)}
            timeError={message(errors.dueTime)}
            disabled={busy}
          />
          <AssigneeField
            people={options}
            selectedIds={form.assigneeIds}
            onToggle={toggle}
            error={message(errors.assignees)}
            disabled={busy}
          />
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
