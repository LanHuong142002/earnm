import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { baseUnitOf, formatPriceText, moneyOf, parsePriceText } from "../ingredients/display";
import type { Ingredient } from "../ingredients/types";
import type { Currency } from "../lib/currency";
import { Hint, LinkRow } from "../products/ProductBits";
import { validMoney } from "../products/recipeEdit";
import { SheetModal } from "../products/SheetModal";
import { SizePills } from "../products/SizePills";
import type { SizeName } from "../products/types";
import { matchesQuery, toggleSize, validateName } from "../products/view";
import { useTheme } from "../theme/useTheme";
import { Card } from "../ui/Card";
import { PressableScale } from "../ui/PressableScale";
import { TextField } from "../ui/TextField";
import type { DraftStatus } from "./types";
import { baseSize, DRAFT_NAME_MAX, DRAFT_NOTE_MAX, unitPriceText, type MissingItem } from "./view";

/** The line of the red list in the status sheet: "Siro hoa hồng chưa có giá mua". */
export function missingText(t: TFunction, item: MissingItem): string {
  switch (item.kind) {
    case "name":
      return t("drafts.missingName");
    case "sizes":
      return t("drafts.missingSizes");
    case "lines":
      return t("drafts.missingLines");
    case "price":
      return t("drafts.missingPrice", { name: item.name });
    case "qty":
      return t("drafts.missingQty", { name: item.name });
  }
}

/** The Sửa menu: rename, note, delete. */
export function DraftMenuSheet({
  onRename,
  onNote,
  onDelete,
  onClose,
}: {
  onRename: () => void;
  onNote: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing } = useTheme();
  const rows = [
    { label: t("drafts.menuRename"), onPress: onRename, danger: false },
    { label: t("drafts.menuNote"), onPress: onNote, danger: false },
    { label: t("drafts.menuDelete"), onPress: onDelete, danger: true },
  ];
  return (
    <SheetModal title={t("drafts.menuTitle")} onClose={onClose}>
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

/** Renames the draft (a name is needed) or edits its note (it may be empty). */
export function TextSheet({
  kind,
  initial,
  onSave,
  onClose,
}: {
  kind: "name" | "note";
  initial: string;
  onSave: (value: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const problem = kind === "name" ? validateName(text, [], DRAFT_NAME_MAX) : text.length > DRAFT_NOTE_MAX ? "noteTooLong" : null;
  const message = problem === "nameEmpty" ? t("drafts.errors.nameEmpty") : problem === "nameTooLong" ? t("drafts.errors.nameTooLong") : problem === "noteTooLong" ? t("drafts.errors.noteTooLong") : null;

  async function save() {
    setSubmitted(true);
    if (problem || busy) return;
    setBusy(true);
    const ok = await onSave(text.trim()).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t(kind === "name" ? "drafts.renameTitle" : "drafts.noteTitle")} onClose={onClose} action={{ label: t("drafts.save"), onPress: save }}>
      <TextField
        label={t(kind === "name" ? "drafts.nameLabel" : "drafts.noteLabel")}
        icon={kind === "name" ? "cafe-outline" : "document-text-outline"}
        autoFocus
        value={text}
        multiline={kind === "note"}
        onChangeText={setText}
        error={submitted ? message : null}
        onSubmitEditing={kind === "name" ? save : undefined}
      />
    </SheetModal>
  );
}

/** Sizes and the expected price of the base size, both editable after the draft exists. */
export function SizesPriceSheet({
  initialSizes,
  initialPrice,
  currency,
  onSave,
  onClose,
}: {
  initialSizes: readonly SizeName[];
  initialPrice: number | null;
  currency: Currency;
  onSave: (sizes: SizeName[], price: number | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { spacing } = useTheme();
  const [sizes, setSizes] = useState<SizeName[]>([...initialSizes]);
  const [priceText, setPriceText] = useState(initialPrice === null ? "" : formatPriceText(String(currency === "VND" ? initialPrice : initialPrice / 100), currency));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const typed = priceText.trim() === "" ? null : parsePriceText(priceText, currency);
  const invalid = priceText.trim() !== "" && !validMoney(typed);
  const base = baseSize(sizes);

  async function save() {
    setSubmitted(true);
    if (invalid || busy) return;
    setBusy(true);
    const ok = await onSave(sizes, typed).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t("drafts.sizesSheetTitle")} onClose={onClose} action={{ label: t("drafts.save"), onPress: save }}>
      <View style={{ gap: spacing[2] }}>
        <SizePills value={sizes} onToggle={(size) => setSizes((c) => toggleSize(c, size))} />
        <Hint>{t("drafts.sizesHint")}</Hint>
        <TextField
          label={t("drafts.expectedPriceLabel", { size: base ?? "" })}
          icon="cash-outline"
          placeholder={moneyOf(0, currency)}
          value={priceText}
          onChangeText={(text) => setPriceText(currency === "VND" ? formatPriceText(text, currency) : text.replace(/[^\d.,]/g, ""))}
          keyboardType={currency === "VND" ? "number-pad" : "decimal-pad"}
          error={submitted && invalid ? t("drafts.errors.priceInvalid") : null}
          onSubmitEditing={save}
        />
        <Hint>{t("drafts.expectedPriceHint")}</Hint>
      </View>
    </SheetModal>
  );
}

/**
 * The status sheet (mockups A3 and A6): Đang làm and Xong as plain rows, the current one in bold and announced as
 * selected (no tick). Choosing Xong while something is missing keeps the sheet open and lists it in red; each item opens its line.
 */
export function StatusSheet({
  status,
  missing,
  onChoose,
  onOpenMissing,
  onClose,
}: {
  status: DraftStatus;
  /** What the draft still lacks for Done, from `missingForDone`. */
  missing: readonly MissingItem[];
  onChoose: (status: DraftStatus) => Promise<boolean>;
  onOpenMissing: (item: MissingItem) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, layout, spacing, iconSize } = useTheme();
  const [blocked, setBlocked] = useState(false);
  const options: { value: DraftStatus; label: string }[] = [
    { value: "working", label: t("drafts.statusWorking") },
    { value: "done", label: t("drafts.statusDone") },
  ];

  async function choose(next: DraftStatus) {
    if (next === status) return onClose();
    if (next === "done" && missing.length > 0) return setBlocked(true);
    const ok = await onChoose(next).catch(() => false);
    if (ok) onClose();
  }

  return (
    <SheetModal title={t("drafts.statusSheetTitle")} onClose={onClose}>
      <View style={{ gap: spacing[1] }}>
        <View>
          {options.map((o) => (
            <PressableScale
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: o.value === status }}
              onPress={() => void choose(o.value)}
              style={{ minHeight: layout.controlHeight + spacing[1], justifyContent: "center" }}
            >
              <Text style={[o.value === status ? typography.bodyStrong : typography.body, { color: o.value === "done" ? colors.success : colors.text }]}>{o.label}</Text>
            </PressableScale>
          ))}
        </View>
        {blocked && missing.length > 0 ? (
          <View accessibilityRole="alert" style={{ gap: spacing[0], padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}>
            <Text style={[typography.bodyStrong, { color: colors.danger }]}>{t("drafts.missingTitle")}</Text>
            {missing.map((item, index) => (
              <PressableScale
                key={`${item.kind}-${"name" in item ? item.name : index}`}
                accessibilityRole="button"
                accessibilityLabel={missingText(t, item)}
                onPress={() => onOpenMissing(item)}
                style={{ minHeight: layout.controlHeight, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[1] }}
              >
                <Text style={[typography.body, { color: colors.danger, flex: 1 }]}>{`· ${missingText(t, item)}`}</Text>
                <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.danger} />
              </PressableScale>
            ))}
          </View>
        ) : null}
      </View>
    </SheetModal>
  );
}

/**
 * "Thêm vào công thức" (mockup A4): search the project's ingredients; each match has a Thêm link, and the last row
 * adds what was typed as a new ingredient of the draft.
 */
export function AddLineSheet({
  ingredients,
  usedIds,
  usedNames,
  currency,
  onAddExisting,
  onAddNew,
  onClose,
}: {
  ingredients: readonly Ingredient[];
  /** Ingredients already in the recipe; they cannot be added twice. */
  usedIds: ReadonlySet<string>;
  /** The draft's new-ingredient names, so the same one is not offered twice. */
  usedNames: readonly string[];
  currency: Currency;
  onAddExisting: (ingredient: Ingredient) => void;
  onAddNew: (name: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, layout, spacing } = useTheme();
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const matches = ingredients.filter((i) => !usedIds.has(i.id) && matchesQuery(i.name, query));
  const key = trimmed.toLocaleLowerCase("vi");
  const exists = ingredients.some((i) => i.name.trim().toLocaleLowerCase("vi") === key) || usedNames.some((n) => n.trim().toLocaleLowerCase("vi") === key);
  const rowStyle = (divider: boolean) => ({
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing[1],
    minHeight: layout.controlHeight + spacing[0],
    paddingHorizontal: spacing[2],
    borderTopWidth: divider ? StyleSheet.hairlineWidth : 0,
    borderTopColor: colors.border,
  });

  return (
    <SheetModal title={t("drafts.addTitle")} onClose={onClose}>
      <View style={{ gap: spacing[2] }}>
        <TextField label={t("drafts.searchLabel")} icon="search-outline" autoFocus value={query} onChangeText={setQuery} returnKeyType="search" />
        {matches.length === 0 && trimmed === "" ? <Hint>{t("drafts.addEmpty")}</Hint> : null}
        {matches.length > 0 || (trimmed !== "" && !exists) ? (
          <Card flush>
            {matches.map((ingredient, index) => {
              const price = unitPriceText(ingredient.purchase, currency, t(`ingredients.units.${baseUnitOf(ingredient.purchase.unit)}`));
              return (
                <View key={ingredient.id} style={rowStyle(index > 0)}>
                  <Text style={[typography.body, { color: colors.text, flex: 1 }]} numberOfLines={2}>
                    {ingredient.name}
                    {price ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{` · ${price}`}</Text> : null}
                  </Text>
                  <PressableScale
                    accessibilityRole="button"
                    accessibilityLabel={`${t("drafts.add")} ${ingredient.name}`}
                    onPress={() => onAddExisting(ingredient)}
                    style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
                  >
                    <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("drafts.add")}</Text>
                  </PressableScale>
                </View>
              );
            })}
            {trimmed !== "" && !exists ? (
              <View style={[rowStyle(matches.length > 0), { paddingHorizontal: spacing[2] }]}>
                <LinkRow label={t("drafts.addNew", { query: trimmed })} onPress={() => onAddNew(trimmed)} />
              </View>
            ) : null}
          </Card>
        ) : null}
      </View>
    </SheetModal>
  );
}
