import { Ionicons } from "@expo/vector-icons";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { PressableScale } from "../../ui/PressableScale";
import { minimumDay, minimumTimeFor } from "../dueRules";
import { dateToDay, dateToTime, dayToDate, timeToDate } from "../formState";

/**
 * A day or time field that opens its native picker right under it, the same way the task's due field does (iOS: inline
 * with a Done button; Android: its dialog). `limitToFuture` keeps a one-off from being set in the past.
 */
export function PickerField({
  kind,
  day,
  time,
  text,
  label,
  icon,
  limitToFuture,
  onChangeDay,
  onChangeTime,
  invalid = false,
}: {
  kind: "day" | "time";
  /** The reminder's start day (for a time) or the day being picked (for a day). */
  day: string;
  time: string;
  text: string;
  label: string;
  icon: "calendar-outline" | "time-outline";
  limitToFuture: boolean;
  onChangeDay?: (day: string) => void;
  onChangeTime?: (time: string) => void;
  invalid?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { colors, typography, layout, radius, spacing, iconSize, scheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ios = Platform.OS === "ios";
  const now = new Date();
  return (
    <View
      style={{
        borderRadius: radius.field,
        borderWidth: 1.5,
        borderColor: invalid ? colors.danger : "transparent",
        backgroundColor: invalid ? colors.dangerBg : colors.field,
        overflow: "hidden",
      }}
    >
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text }}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((o) => !o)}
        style={{ minHeight: layout.controlHeight, flexDirection: "row", alignItems: "center", gap: spacing[1], paddingHorizontal: spacing[2] }}
      >
        <Ionicons name={icon} size={iconSize.sm} color={colors.placeholder} />
        <Text style={[typography.body, { flex: 1, color: colors.text }]}>{text}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={iconSize.sm} color={colors.textSecondary} />
      </PressableScale>
      {open ? (
        <View style={{ paddingHorizontal: spacing[1], paddingBottom: spacing[1] }}>
          <DateTimePicker
            mode={kind === "day" ? "date" : "time"}
            value={kind === "day" ? (day >= dateToDay(now) || !limitToFuture ? dayToDate(day) : minimumDay(now)) : timeToDate(day, time)}
            display={ios ? (kind === "day" ? "inline" : "spinner") : "default"}
            presentation={ios ? "inline" : "dialog"}
            minimumDate={kind === "day" ? (limitToFuture ? minimumDay(now) : undefined) : limitToFuture ? minimumTimeFor(day, now) : undefined}
            maximumDate={kind === "day" ? new Date(9999, 11, 31) : undefined}
            is24Hour
            locale={i18n.language === "vi" ? "vi_VN" : "en_US"}
            accentColor={colors.accentStrong}
            themeVariant={scheme}
            onValueChange={(_event, date) => {
              if (kind === "day") onChangeDay?.(dateToDay(date));
              else onChangeTime?.(dateToTime(date));
              if (!ios) setOpen(false);
            }}
            onDismiss={() => setOpen(false)}
          />
          {ios ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t("tasks.pickerDone")}
              onPress={() => setOpen(false)}
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
