import { useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../theme/useTheme";
import { PressableScale } from "../ui/PressableScale";
import { TextField } from "../ui/TextField";
import { Hint } from "./ProductBits";
import { SheetModal } from "./SheetModal";
import { SizePills } from "./SizePills";
import type { SizeName } from "./types";
import { PRODUCT_NAME_MAX, toggleSize, validateName } from "./view";

/** The ••• menu: rename, add or remove sizes, delete. */
export function MenuSheet({
  onRename,
  onSizes,
  onDelete,
  onClose,
}: {
  onRename: () => void;
  onSizes: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing } = useTheme();
  const rows = [
    { label: t("products.menuRename"), onPress: onRename, danger: false },
    { label: t("products.menuSizes"), onPress: onSizes, danger: false },
    { label: t("products.menuDelete"), onPress: onDelete, danger: true },
  ];
  return (
    <SheetModal title={t("products.menuTitle")} onClose={onClose}>
      <View>
        {rows.map((row) => (
          <PressableScale
            key={row.label}
            accessibilityRole="button"
            accessibilityLabel={row.label}
            onPress={row.onPress}
            style={{ minHeight: layout.controlHeight + spacing[1], justifyContent: "center" }}
          >
            <Text style={[typography.body, { color: row.danger ? colors.danger : colors.text }]}>{row.label}</Text>
          </PressableScale>
        ))}
      </View>
    </SheetModal>
  );
}

export function RenameSheet({
  initial,
  others,
  onSave,
  onClose,
}: {
  initial: string;
  others: readonly string[];
  onSave: (name: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = validateName(name, others, PRODUCT_NAME_MAX);

  async function save() {
    setSubmitted(true);
    if (problem || busy) return;
    setBusy(true);
    const ok = await onSave(name.trim()).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t("products.renameTitle")} onClose={onClose} action={{ label: t("products.save"), onPress: save }}>
      <TextField
        label={t("products.nameLabel")}
        icon="cafe-outline"
        autoFocus
        value={name}
        onChangeText={setName}
        error={submitted && problem ? t(`products.errors.${problem}`) : null}
        onSubmitEditing={save}
      />
    </SheetModal>
  );
}

export function SizesSheet({
  initial,
  onSave,
  onClose,
}: {
  initial: readonly SizeName[];
  onSave: (sizes: SizeName[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [chosen, setChosen] = useState<SizeName[]>([...initial]);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    const ok = await onSave(chosen).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t("products.sizesTitle")} onClose={onClose} action={{ label: t("products.save"), onPress: save }}>
      <SizePills value={chosen} onToggle={(size) => setChosen((c) => toggleSize(c, size))} />
      <Hint>{t("products.sizesSheetHint")}</Hint>
    </SheetModal>
  );
}
