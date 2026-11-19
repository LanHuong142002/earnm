import type { ReactNode } from "react";
import { Modal } from "react-native";
import { useTranslation } from "react-i18next";

import { SheetFrame, SheetLink } from "../tasks/SheetFrame";

/**
 * A bottom sheet over the screen (iOS page sheet with swipe-down; Android a modal). The head has Hủy on the left and
 * `action` (Lưu or Xong) on the right; both close it, as does a swipe down or the back button.
 */
export function SheetModal({
  title,
  onClose,
  action,
  children,
}: {
  title: string;
  onClose: () => void;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SheetFrame
        title={title}
        left={action ? <SheetLink label={t("common.cancel")} onPress={onClose} /> : undefined}
        right={action ? <SheetLink strong label={action.label} onPress={action.onPress} /> : <SheetLink strong label={t("products.done")} onPress={onClose} />}
      >
        {children}
      </SheetFrame>
    </Modal>
  );
}
