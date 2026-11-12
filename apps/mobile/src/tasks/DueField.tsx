import { Ionicons } from "@expo/vector-icons";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { ErrorText } from "../ui/ErrorText";
import { PressableScale } from "../ui/PressableScale";
import { formatDue, type DueLanguage } from "./dueDate";
import { dateToDay, dateToTime, dayToDate, timeToDate } from "./formState";

type Picking = "day" | "time" | null;

/**
 * Due date: pick a day, optionally add a time, clear either. Clearing the day clears the time.
 * The calendar and clock are `@expo/ui`'s native picker (iOS: shown inline under the field with a
 * Done link; Android: a dialog that opens on mount and is unmounted on confirm or cancel).
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

  const row = (invalid: boolean) =>
    ({
      flexDirection: "row",
      alignItems: "center",
      minHeight: layout.controlHeight,
      borderRadius: radius.field,
      borderWidth: 1.5,
      borderColor: invalid ? colors.danger : "transparent",
      backgroundColor: invalid ? colors.dangerBg : colors.field,
    }) as const;

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

  function field(opts: {
    icon: "calendar-outline" | "time-outline";
    text: string | null;
    placeholder: string;
    label: string;
    invalid: boolean;
    onPress: () => void;
    onClear: (() => void) | null;
    clearLabel: string;
  }) {
    return (
      <View style={row(opts.invalid)}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={opts.label}
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
      </View>
    );
  }

  const picker =
    picking === null || (picking === "time" && dueDate === null) ? null : (
      <DateTimePicker
        mode={picking === "day" ? "date" : "time"}
        value={picking === "day" ? (dueDate !== null ? dayToDate(dueDate) : new Date()) : timeToDate(dueDate ?? "", dueTime)}
        display={ios ? (picking === "day" ? "inline" : "spinner") : "default"}
        presentation={ios ? "inline" : "dialog"}
        minimumDate={picking === "day" ? new Date(1900, 0, 1) : undefined}
        maximumDate={picking === "day" ? new Date(9999, 11, 31) : undefined}
        is24Hour
        locale={locale}
        accentColor={colors.accentStrong}
        themeVariant={scheme}
        onValueChange={(_event, date) => {
          if (picking === "day") onChangeDay(dateToDay(date));
          else onChangeTime(dateToTime(date));
          // The Android dialog is done after one choice; iOS stays open until Done.
          if (!ios) setPicking(null);
        }}
        onDismiss={() => setPicking(null)}
      />
    );

  return (
    <View style={{ gap: spacing[0] }}>
      <Text style={[typography.label, { color: colors.text }]}>{t("tasks.dueLabel")}</Text>
      {field({
        icon: "calendar-outline",
        text: dayText,
        placeholder: t("tasks.dueNone"),
        label: dayText !== null ? t("tasks.dueDayLabel", { date: dayText }) : t("tasks.dueDayPick"),
        invalid: !!dateError,
        onPress: () => {
          // iOS only reports a change, so opening the calendar with no day sets today; Done then saves it.
          if (ios && picking !== "day" && dueDate === null) onChangeDay(dateToDay(new Date()));
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
      {dueDate !== null
        ? field({
            icon: "time-outline",
            text: dueTime,
            placeholder: t("tasks.dueTimeAdd"),
            label: dueTime !== null ? t("tasks.dueTimeLabel", { time: dueTime }) : t("tasks.dueTimeAdd"),
            invalid: !!timeError,
            onPress: () => {
              // iOS only reports a change, so opening the clock sets the shown default (noon);
              // the person can adjust or clear it. The Android dialog sets it on confirm.
              if (ios && picking !== "time" && dueTime === null) onChangeTime("12:00");
              setPicking(picking === "time" ? null : "time");
            },
            onClear: dueTime !== null ? () => onChangeTime(null) : null,
            clearLabel: t("tasks.dueClearTime"),
          })
        : null}
      {timeError ? <ErrorText message={timeError} /> : null}
      {picker}
      {ios && picking !== null ? (
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
  );
}
