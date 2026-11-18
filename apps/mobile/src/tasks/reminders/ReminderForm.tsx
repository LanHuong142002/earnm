import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRef, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { Avatar } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { ErrorText } from "../../ui/ErrorText";
import { PressableScale } from "../../ui/PressableScale";
import { Screen } from "../../ui/Screen";
import { formatDue, type DueLanguage } from "../dueDate";
import { useTasks } from "../TasksProvider";
import { defaultReminderForm, deviceTimezone, formFromReminder, setRepeat, type ReminderForm as Form } from "./formState";
import { defaultEndDate, toggleRecipient, toggleWeekday, visibleErrors } from "./formView";
import { reminderLabel } from "./labels";
import { permissionState } from "./notifications";
import { shouldAskAfterSave } from "./notificationLogic";
import { PickerField } from "./PickerField";
import { usePeople } from "./usePeople";
import { useReminderT } from "./useReminderT";
import { useTaskReminders } from "./useTaskReminders";
import type { ReminderRepeat } from "./types";

const REPEATS: ReminderRepeat[] = ["once", "daily", "weekly", "monthly"];
/** Shown Monday first, as the week is read here. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

/**
 * The reminder screen (mockups 2a-2d): date, time, repeat, weekdays, end, recipients. Used to add (no `reminderId`) and
 * to edit. Back returns without saving; Lưu and a confirmed delete go back one screen. Nothing here replaces a screen.
 */
export function ReminderForm({ projectId, taskId, reminderId }: { projectId: string; taskId: string; reminderId?: string }) {
  const { t, i18n } = useTranslation();
  const rt = useReminderT();
  const router = useRouter();
  const { colors, typography, layout, radius, spacing } = useTheme();
  const headerHeight = useHeaderHeight();
  const { tasksFor } = useTasks();
  const task = tasksFor(projectId).find((x) => x.id === taskId) ?? null;
  const editing = reminderId !== undefined;

  const [state, setState] = useState<{ opened: Form; form: Form } | null>(null);
  const { options, names, meId } = usePeople(projectId, state?.form.recipientIds ?? []);
  const reminders = useTaskReminders({ projectId, taskId, meId });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // The form opens once the task (and, when editing, the reminder) is known. What it opened with is kept to tell what changed.
  const found = editing ? reminders.reminders.find((r) => r.id === reminderId) : undefined;
  if (state === null && task !== null && meId !== null) {
    if (!editing) {
      const initial = defaultReminderForm({ task, meId, now: new Date(), timezone: deviceTimezone() });
      setState({ opened: initial, form: initial });
    } else if (found) {
      const initial = formFromReminder(found);
      setState({ opened: initial, form: initial });
    }
  }
  if (state === null) {
    return (
      <Screen edges={[]} keyboardOffset={headerHeight}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ height: layout.controlHeight, width: "60%", borderRadius: radius.field, backgroundColor: colors.field }}
        />
      </Screen>
    );
  }

  const { opened, form } = state;
  const lang: DueLanguage = i18n.language === "vi" ? "vi" : "en";
  const errors = visibleErrors(editing ? opened : null, form, new Date());
  const invalid = Object.keys(errors).length > 0;
  const update = (change: (f: Form) => Form) => setState((s) => (s ? { ...s, form: change(s.form) } : s));
  const assigned = new Set(task?.assignees.map((a) => a.id) ?? []);

  const label = (text: string) => <Text style={[typography.label, { color: colors.text }]}>{text}</Text>;

  async function save() {
    if (inFlight.current || invalid) return;
    inFlight.current = true;
    setBusy(true);
    setSaveError(null);
    try {
      const result = reminderId !== undefined ? await reminders.edit(reminderId, opened, form) : await reminders.add(form);
      if (!result.ok) {
        if (result.reason === "limit") setSaveError(t("tasks.errors.reminderLimit"));
        else if (result.reason === "not_found") router.back();
        else setSaveError(t("errors.generic"));
        return;
      }
      // Back to the task. The first time, the explanation sheet opens over it before iOS asks (R15).
      const ask = shouldAskAfterSave(await permissionState().catch(() => "granted" as const));
      router.back();
      if (ask) router.push({ pathname: "/projects/[id]/tasks/[taskId]/reminders/permission", params: { id: projectId, taskId } });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function confirmDelete() {
    if (reminderId === undefined) return;
    const who = form.recipientIds.map((id) => names[id]).filter(Boolean).join(", ");
    Alert.alert(t("tasks.reminders.deleteTitle"), t("tasks.reminders.deleteMessage", { who, when: reminderLabel({ ...form, endDate: null }, rt) }), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("tasks.reminders.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          void reminders.remove(reminderId).then(() => router.back());
        },
      },
    ]);
  }

  const dayText = formatDue(form.startDate, null, lang, t);
  const selectedStyle = (on: boolean) => ({
    backgroundColor: on ? colors.tile : colors.field,
    borderWidth: 1.5,
    borderColor: on ? colors.accent : "transparent",
  });

  return (
    <Screen
      edges={[]}
      keyboardOffset={headerHeight}
      footer={
        <>
          {saveError ? <ErrorText message={saveError} /> : null}
          <Button label={t("tasks.reminders.save")} loading={busy} disabled={invalid} onPress={() => void save()} />
          {editing ? <Button label={t("tasks.reminders.delete")} variant="danger" onPress={confirmDelete} /> : null}
        </>
      }
    >
      <View style={{ gap: spacing[0] }}>
        {label(form.repeat === "once" ? t("tasks.reminders.dateLabel") : t("tasks.reminders.startLabel"))}
        <PickerField
          kind="day"
          day={form.startDate}
          time={form.time}
          text={dayText}
          label={t("tasks.reminders.dateA11y")}
          icon="calendar-outline"
          limitToFuture={form.repeat === "once"}
          onChangeDay={(startDate) => update((f) => ({ ...f, startDate }))}
          invalid={errors.date !== undefined}
        />
        <PickerField
          kind="time"
          day={form.startDate}
          time={form.time}
          text={form.time}
          label={t("tasks.reminders.timeA11y")}
          icon="time-outline"
          limitToFuture={form.repeat === "once"}
          onChangeTime={(time) => update((f) => ({ ...f, time }))}
          invalid={errors.date !== undefined}
        />
        {errors.date ? <ErrorText message={t(errors.date)} /> : null}
      </View>

      <View style={{ gap: spacing[0] }}>
        {label(t("tasks.reminders.repeatLabel"))}
        <View
          accessibilityRole="radiogroup"
          style={{ flexDirection: "row", backgroundColor: colors.field, borderRadius: radius.field, padding: 3, gap: 3 }}
        >
          {REPEATS.map((repeat) => {
            const on = form.repeat === repeat;
            return (
              <PressableScale
                key={repeat}
                accessibilityRole="radio"
                accessibilityLabel={t(`tasks.reminders.repeat.${repeat}`)}
                accessibilityState={{ selected: on, checked: on }}
                onPress={() => update((f) => setRepeat(f, repeat))}
                style={{
                  flex: 1,
                  minHeight: layout.controlHeight - 6,
                  borderRadius: radius.field - 2,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: on ? colors.surface : "transparent",
                  borderWidth: on ? 1 : 0,
                  borderColor: colors.border,
                }}
              >
                <Text style={[typography.label, { color: on ? colors.text : colors.textSecondary }]}>{t(`tasks.reminders.repeat.${repeat}`)}</Text>
              </PressableScale>
            );
          })}
        </View>
      </View>

      {form.repeat === "weekly" ? (
        <View style={{ gap: spacing[0] }}>
          {label(t("tasks.reminders.weekdaysLabel"))}
          <View style={{ flexDirection: "row", gap: spacing[0] }}>
            {WEEKDAY_ORDER.map((day) => {
              const on = form.weekdays.includes(day);
              return (
                <PressableScale
                  key={day}
                  accessibilityRole="checkbox"
                  accessibilityLabel={t(`tasks.reminders.weekdayName.${day}`)}
                  accessibilityState={{ checked: on }}
                  onPress={() => update((f) => ({ ...f, weekdays: toggleWeekday(f.weekdays, day) }))}
                  style={[
                    { flex: 1, minHeight: layout.controlHeight, borderRadius: radius.field, alignItems: "center", justifyContent: "center" },
                    selectedStyle(on),
                  ]}
                >
                  <Text style={[typography.label, { color: on ? colors.accentStrong : colors.text }]}>{t(`tasks.weekday.${day}`)}</Text>
                </PressableScale>
              );
            })}
          </View>
          {errors.weekdays ? <ErrorText message={t(errors.weekdays)} /> : null}
        </View>
      ) : null}

      {form.repeat !== "once" ? (
        <View style={{ gap: spacing[0] }}>
          {label(t("tasks.reminders.endLabel"))}
          <View style={{ flexDirection: "row", gap: spacing[0], flexWrap: "wrap" }}>
            {([false, true] as const).map((onDate) => {
              const on = (form.endDate !== null) === onDate;
              const name = t(onDate ? "tasks.reminders.endOnDate" : "tasks.reminders.endNever");
              return (
                <PressableScale
                  key={String(onDate)}
                  accessibilityRole="radio"
                  accessibilityLabel={name}
                  accessibilityState={{ selected: on, checked: on }}
                  onPress={() => update((f) => ({ ...f, endDate: onDate ? (f.endDate ?? defaultEndDate(f.startDate)) : null }))}
                  style={[
                    { minHeight: layout.controlHeight, paddingHorizontal: spacing[3], borderRadius: radius.pill, justifyContent: "center" },
                    selectedStyle(on),
                  ]}
                >
                  <Text style={[on ? typography.bodyStrong : typography.body, { color: on ? colors.accentStrong : colors.text }]}>{name}</Text>
                </PressableScale>
              );
            })}
          </View>
          {form.endDate !== null ? (
            <>
              <PickerField
                kind="day"
                day={form.endDate}
                time={form.time}
                text={formatDue(form.endDate, null, lang, t)}
                label={t("tasks.reminders.endDateA11y")}
                icon="calendar-outline"
                limitToFuture={false}
                onChangeDay={(endDate) => update((f) => ({ ...f, endDate }))}
                invalid={errors.endDate !== undefined}
              />
              {errors.endDate ? <ErrorText message={t(errors.endDate)} /> : null}
            </>
          ) : null}
        </View>
      ) : null}

      <View style={{ gap: spacing[0] }}>
        {label(t("tasks.reminders.recipientsLabel"))}
        <View
          style={{
            backgroundColor: colors.surface,
            borderWidth: errors.recipients ? 1.5 : 1,
            borderColor: errors.recipients ? colors.danger : colors.border,
            borderRadius: radius.card,
            overflow: "hidden",
            paddingHorizontal: spacing[2],
          }}
        >
          {options.map((person, i) => {
            const on = form.recipientIds.includes(person.id);
            const blocked = person.former && !on;
            return (
              <PressableScale
                key={person.id}
                accessibilityRole="checkbox"
                accessibilityLabel={person.displayName}
                accessibilityHint={assigned.has(person.id) ? t("tasks.reminders.assigned") : undefined}
                accessibilityState={{ checked: on, disabled: blocked }}
                disabled={blocked}
                onPress={() => update((f) => ({ ...f, recipientIds: toggleRecipient(f.recipientIds, person.id) }))}
                style={{
                  minHeight: layout.controlHeight + 4,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing[2],
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: colors.border,
                }}
              >
                {/* A checkbox keeps its tick. */}
                <View
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: radius.checkbox,
                    borderWidth: 1.5,
                    borderColor: on ? colors.accent : colors.placeholder,
                    backgroundColor: on ? colors.accent : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {on ? <Ionicons name="checkmark" size={14} color={colors.onAccent} /> : null}
                </View>
                <Avatar letter={person.displayName.trim().charAt(0).toUpperCase()} />
                <Text style={[typography.body, { flex: 1, color: colors.text }]}>
                  {person.displayName}
                  {assigned.has(person.id) ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{` · ${t("tasks.reminders.assigned")}`}</Text> : null}
                </Text>
              </PressableScale>
            );
          })}
        </View>
        {errors.recipients ? <ErrorText message={t(errors.recipients)} /> : null}
      </View>
    </Screen>
  );
}
