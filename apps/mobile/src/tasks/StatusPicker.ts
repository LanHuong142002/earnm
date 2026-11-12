import type { TFunction } from "i18next";
import { ActionSheetIOS, Alert, Platform } from "react-native";

import { TASK_STATUSES, type TaskStatus } from "./types";

/** One tap on a status pill opens this: an action sheet on iOS, Alert buttons elsewhere (spec R23). */
export function showStatusPicker(t: TFunction, current: TaskStatus, onPick: (status: TaskStatus) => void): void {
  const label = (status: TaskStatus) => `${status === current ? "✓ " : ""}${t(`tasks.status.${status}`)}`;
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("tasks.changeStatus"),
        options: [...TASK_STATUSES.map(label), t("common.cancel")],
        cancelButtonIndex: TASK_STATUSES.length,
      },
      (index) => {
        const picked = TASK_STATUSES[index];
        if (picked !== undefined && picked !== current) onPick(picked);
      },
    );
    return;
  }
  Alert.alert(t("tasks.changeStatus"), undefined, [
    ...TASK_STATUSES.map((status) => ({
      text: label(status),
      onPress: () => {
        if (status !== current) onPick(status);
      },
    })),
    { text: t("common.cancel"), style: "cancel" as const },
  ]);
}
