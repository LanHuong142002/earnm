import type { TFunction } from "i18next";
import { ActionSheetIOS, Alert, Platform } from "react-native";

/** The ⋯ menu of a checklist: an action sheet on iOS, Alert buttons elsewhere (like the status picker). */
export function showChecklistMenu(t: TFunction, name: string, onRename: () => void, onDelete: () => void): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: name,
        options: [t("tasks.checklists.rename"), t("tasks.checklists.delete"), t("common.cancel")],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) onRename();
        else if (index === 1) onDelete();
      },
    );
    return;
  }
  Alert.alert(
    name,
    undefined,
    [
      { text: t("tasks.checklists.rename"), onPress: onRename },
      { text: t("tasks.checklists.delete"), style: "destructive", onPress: onDelete },
      { text: t("common.cancel"), style: "cancel" },
    ],
    { cancelable: true },
  );
}

/** Asks before deleting a checklist, naming it and how many items go with it. */
export function confirmDeleteChecklist(t: TFunction, name: string, itemCount: number, onConfirm: () => void): void {
  Alert.alert(
    t("tasks.checklists.deleteTitle", { name }),
    t("tasks.checklists.deleteMessage", { count: itemCount }),
    [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("tasks.deleteConfirm"), style: "destructive", onPress: onConfirm },
    ],
    { cancelable: true },
  );
}
