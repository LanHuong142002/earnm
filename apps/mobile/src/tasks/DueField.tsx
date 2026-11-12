import { Ionicons } from "@expo/vector-icons";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { ErrorText } from "../ui/ErrorText";
import { PressableScale } from "../ui/PressableScale";
import { canAddTime, defaultTimeFor, minimumDay, minimumTimeFor } from "./dueRules";
import { formatDue, type DueLanguage } from "./dueDate";
import { dateToDay, dateToTime, dayToDate, timeToDate } from "./formState";

type Picking = "day" | "time" | null;

/**
 * Due date: pick a day, optionally add a time, clear either. Clearing the day clears the time.
 * Each field opens in place, like a collapsible section: tapping it expands the field with the
 * native picker inside it (iOS; Done or a second tap closes it), and Android shows its dialog.
 * Days and times before now can't be picked.
 */
export function DueField({
  dueDate,
  dueTime,
  onChangeDay,
  onChangeTime,
  dateError,
  timeError,
  disabled = false,
}: {
  dueDate: string | null;
  dueTime: string | null;
  /** A picked day, or null when cleared. */
  onChangeDay: (day: string | null) => void;
  /** A picked time (`HH:mm`), or null when cleared. */
  onChangeTime: (time: string | null) => void;
  dateError?: string | null;
  timeError?: string | null;
  disabled?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, layout, radius, spacing, iconSize, scheme } = useTheme();
  const lang: DueLanguage = i18n.language === "vi" ? "vi" : "en";
  const [picking, setPicking] = useState<Picking>(null);
  const ios = Platform.OS === "ios";
  const dayText = dueDate !== null ? formatDue(dueDate, null, lang, t) : null;
  const locale = lang === "vi" ? "vi_VN" : "en_US";

  function clearButton(label: string, onPress: () => void) {
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={disabled}
        onPress={onPress}
        style={{ width: layout.controlHeight, height: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
      >
        <Ionicons name="close" size={iconSize.md} color={colors.textSecondary} />
      </PressableScale>
    );
  }

  function picker(kind: "day" | "time") {
    const now = new Date();
    const today = minimumDay(now);
    return (
      <DateTimePicker
        mode={kind === "day" ? "date" : "time"}
        // A day that already passed is shown as today: it is not a choice that can be made again.
        value={
          kind === "day"
            ? dueDate !== null && dueDate >= dateToDay(now)
              ? dayToDate(dueDate)
              : today
            : timeToDate(dueDate ?? "", dueTime)
        }
        display={ios ? (kind === "day" ? "inline" : "spinner") : "default"}
        presentation={ios ? "inline" : "dialog"}
        minimumDate={kind === "day" ? today : dueDate !== null ? minimumTimeFor(dueDate, now) : undefined}
        maximumDate={kind === "day" ? new Date(9999, 11, 31) : undefined}
        is24Hour
        locale={locale}
        accentColor={colors.accentStrong}
        themeVariant={scheme}
        onValueChange={(_event, date) => {
          if (kind === "day") onChangeDay(dateToDay(date));
          else onChangeTime(dateToTime(date));
          // The Android dialog is done after one choice; iOS stays open until Done.
          if (!ios) setPicking(null);
        }}
        onDismiss={() => setPicking(null)}
      />
    );
  }

  function field(opts: {
    kind: "day" | "time";
    icon: "calendar-outline" | "time-outline";
    text: string | null;
    placeholder: string;
    label: string;
    invalid: boolean;
    onPress: () => void;
    onClear: (() => void) | null;
    clearLabel: string;
  }) {
    const open = picking === opts.kind;
    return (
      <View
        style={{
          borderRadius: radius.field,
          borderWidth: 1.5,
          borderColor: opts.invalid ? colors.danger : "transparent",
          backgroundColor: opts.invalid ? colors.dangerBg : colors.field,
          overflow: "hidden",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", minHeight: layout.controlHeight }}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={opts.label}
            accessibilityState={{ expanded: open, disabled }}
            disabled={disabled}
            onPress={opts.onPress}
            style={{
              flex: 1,
              minHeight: layout.controlHeight,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing[1],
              paddingLeft: spacing[2],
            }}
          >
            <Ionicons name={opts.icon} size={iconSize.sm} color={colors.placeholder} />
            <Text
              style={[typography.body, { color: opts.text !== null ? colors.text : colors.placeholder, flexShrink: 1 }]}
            >
              {opts.text ?? opts.placeholder}
            </Text>
          </PressableScale>
          {opts.onClear ? clearButton(opts.clearLabel, opts.onClear) : null}
          <View pointerEvents="none" style={{ width: spacing[5], alignItems: "center" }}>
            <Ionicons name={open ? "chevron-up" : "chevron-down"} size={iconSize.sm} color={colors.textSecondary} />
          </View>
        </View>
        {open ? (
          <View style={{ paddingHorizontal: spacing[1], paddingBottom: spacing[1] }}>
            {picker(opts.kind)}
            {ios ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("tasks.pickerDone")}
                onPress={() => setPicking(null)}
                style={{ minHeight: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
              >
                <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("tasks.pickerDone")}</Text>
              </PressableScale>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={{ gap: spacing[0] }}>
      <Text style={[typography.label, { color: colors.text }]}>{t("tasks.dueLabel")}</Text>
      {field({
        kind: "day",
        icon: "calendar-outline",
        text: dayText,
        placeholder: t("tasks.dueNone"),
        label: dayText !== null ? t("tasks.dueDayLabel", { date: dayText }) : t("tasks.dueDayPick"),
        invalid: !!dateError,
        onPress: () => {
          // iOS only reports a change, so opening the calendar with no day, or a day already past
          // (shown as today), sets today; Done then saves it and the person can still clear it.
          const todayDay = dateToDay(new Date());
          if (ios && picking !== "day" && (dueDate === null || dueDate < todayDay)) onChangeDay(todayDay);
          setPicking(picking === "day" ? null : "day");
        },
        onClear:
          dueDate !== null
            ? () => {
                setPicking(null);
                onChangeDay(null);
              }
            : null,
        clearLabel: t("tasks.dueClearDay"),
      })}
      {dateError ? <ErrorText message={dateError} /> : null}
      {dueDate !== null && (dueTime !== null || canAddTime(dueDate, new Date()))
        ? field({
            kind: "time",
            icon: "time-outline",
            text: dueTime,
            placeholder: t("tasks.dueTimeAdd"),
            label: dueTime !== null ? t("tasks.dueTimeLabel", { time: dueTime }) : t("tasks.dueTimeAdd"),
            invalid: !!timeError,
            onPress: () => {
              // iOS only reports a change, so opening the clock sets the shown default (noon, or now
              // when noon has passed today); the person can adjust or clear it. Android sets it on confirm.
              if (ios && picking !== "time" && dueTime === null) onChangeTime(defaultTimeFor(dueDate, new Date()));
              setPicking(picking === "time" ? null : "time");
            },
            onClear: dueTime !== null ? () => onChangeTime(null) : null,
            clearLabel: t("tasks.dueClearTime"),
          })
        : null}
      {timeError ? <ErrorText message={timeError} /> : null}
    </View>
  );
}
