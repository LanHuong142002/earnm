import { Ionicons } from "@expo/vector-icons";
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatPriceText, moneyOf, parsePriceText } from "../../../../../../ingredients/display";
import type { Currency } from "../../../../../../lib/currency";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { Hint, LinkRow } from "../../../../../../products/ProductBits";
import { ProductRejectedNotice } from "../../../../../../products/ProductRejectedNotice";
import { useProducts } from "../../../../../../products/ProductsProvider";
import { validMoney } from "../../../../../../products/recipeEdit";
import { SheetModal } from "../../../../../../products/SheetModal";
import type { ExtraCost } from "../../../../../../products/types";
import { EXTRA_NAME_MAX } from "../../../../../../products/view";
import { useTheme } from "../../../../../../theme/useTheme";
import { Card } from "../../../../../../ui/Card";
import { Enter } from "../../../../../../ui/Enter";
import { PressableScale } from "../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../ui/Screen";
import { TextField } from "../../../../../../ui/TextField";

type Editing = { kind: "new" } | { kind: "edit"; extra: ExtraCost };

function ExtraCostSheet({
  editing,
  currency,
  onSave,
  onDelete,
  onClose,
}: {
  editing: Editing;
  currency: Currency;
  onSave: (input: { name: string; amount: number; isDefault: boolean }) => Promise<boolean>;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, layout } = useTheme();
  const start = editing.kind === "edit" ? editing.extra : null;
  const [name, setName] = useState(start?.name ?? "");
  const [text, setText] = useState(
    !start || start.amount === 0 ? "" : currency === "VND" ? formatPriceText(String(start.amount), currency) : String(start.amount / 100),
  );
  const [isDefault, setIsDefault] = useState(start?.isDefault ?? false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const clean = name.trim();
  const nameError = clean.length === 0 ? "products.errors.extraNameEmpty" : clean.length > EXTRA_NAME_MAX ? "products.errors.extraNameTooLong" : null;
  const parsed = text.trim() === "" ? 0 : parsePriceText(text, currency);

  async function save() {
    setSubmitted(true);
    if (nameError || !validMoney(parsed) || busy) return;
    setBusy(true);
    const ok = await onSave({ name: clean, amount: parsed, isDefault }).catch(() => false);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <SheetModal
      title={t(editing.kind === "new" ? "products.extra.newTitle" : "products.extra.editTitle")}
      onClose={onClose}
      action={{ label: t("products.save"), onPress: save }}
    >
      <TextField
        label={t("products.extra.nameLabel")}
        icon="snow-outline"
        placeholder={t("products.extra.namePlaceholder")}
        autoFocus={editing.kind === "new"}
        value={name}
        onChangeText={setName}
        error={submitted && nameError ? t(nameError) : null}
      />
      <TextField
        label={t("products.extra.amountLabel")}
        icon="cash-outline"
        keyboardType={currency === "VND" ? "number-pad" : "decimal-pad"}
        placeholder={moneyOf(0, currency)}
        value={text}
        onChangeText={(v) => setText(currency === "VND" ? formatPriceText(v, currency) : v.replace(/[^\d.,]/g, ""))}
        error={submitted && !validMoney(parsed) ? t("products.errors.moneyInvalid") : null}
        onSubmitEditing={save}
      />
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing[1],
          minHeight: layout.controlHeight,
          paddingHorizontal: spacing[2],
          paddingVertical: spacing[1],
          borderRadius: radius.field,
          backgroundColor: colors.field,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[typography.bodyStrong, { color: colors.text }]}>{t("products.extra.defaultLabel")}</Text>
          <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("products.extra.defaultHint")}</Text>
        </View>
        <Switch
          accessibilityLabel={t("products.extra.defaultLabel")}
          value={isDefault}
          onValueChange={setIsDefault}
          trackColor={{ true: colors.accentStrong }}
          thumbColor={colors.surface}
        />
      </View>
      {onDelete ? <LinkRow danger center label={t("products.extra.deleteButton")} onPress={onDelete} /> : null}
    </SheetModal>
  );
}

export default function ExtraCostsScreen() {
  const { t } = useTranslation();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { colors, typography, spacing, layout, iconSize } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const { ready, refresh, extraCostsFor, extraCostPendingFor, createExtraCost, updateExtraCost, removeExtraCost } = useProducts();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const [editing, setEditing] = useState<Editing | null>(null);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  useFocusEffect(
    useCallback(() => {
      if (ready && id) void refresh(id).catch(() => undefined);
    }, [ready, refresh, id]),
  );

  if (!project) return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;

  const currency = project.currency;
  const list = ready ? extraCostsFor(project.id) : [];
  const pending = extraCostPendingFor(project.id);

  const confirmDelete = (extra: ExtraCost) =>
    Alert.alert(t("products.extra.deleteTitle", { name: extra.name }), t("products.extra.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("products.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          void removeExtraCost(project.id, extra.id);
          setEditing(null);
        },
      },
    ]);

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <PressableScale
              accessibilityRole="link"
              accessibilityLabel={t("products.extra.addA11y")}
              onPress={() => setEditing({ kind: "new" })}
              style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
            >
              <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("products.extra.addLink")}</Text>
            </PressableScale>
          ),
        }}
      />
      <OfflineNote />
      <ProductRejectedNotice />
      <Enter index={1}>
        {list.length === 0 ? (
          <View style={{ alignItems: "center", gap: spacing[1], paddingTop: spacing[4] }}>
            <Ionicons name="snow-outline" size={iconSize.xl} color={colors.accent} />
            <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text, textAlign: "center" }]}>
              {t("products.extra.emptyTitle")}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center" }]}>{t("products.extra.emptyBody")}</Text>
          </View>
        ) : (
          <View style={{ gap: spacing[1] }}>
            <Card flush>
              <View style={{ paddingHorizontal: spacing[2] }}>
                {list.map((extra, index) => {
                  const detail = t(extra.isDefault ? "products.extra.perCupDefault" : "products.extra.perCup", { amount: moneyOf(extra.amount, currency) });
                  const isPending = pending.has(extra.id);
                  return (
                    <View
                      key={extra.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing[1],
                        borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                        borderTopColor: colors.border,
                      }}
                    >
                      <PressableScale
                        accessibilityRole="button"
                        accessibilityLabel={[t("products.extra.rowA11y", { name: extra.name, detail }), isPending ? t("products.pending") : null].filter(Boolean).join(", ")}
                        onPress={() => setEditing({ kind: "edit", extra })}
                        style={{ flex: 1, minHeight: layout.controlHeight + spacing[2], justifyContent: "center", gap: spacing[0] / 2, paddingVertical: spacing[1] }}
                      >
                        <Text style={[typography.bodyStrong, { color: colors.text }]}>{extra.name}</Text>
                        <Text style={[typography.caption, { color: colors.textSecondary }]}>
                          {detail}
                          {isPending ? ` · ${t("products.pending")}` : ""}
                        </Text>
                      </PressableScale>
                      <Switch
                        accessibilityLabel={t("products.extra.switchA11y", { name: extra.name })}
                        value={extra.isDefault}
                        onValueChange={(value) => void updateExtraCost(project.id, extra.id, { isDefault: value })}
                        trackColor={{ true: colors.accentStrong }}
                        thumbColor={colors.surface}
                      />
                    </View>
                  );
                })}
              </View>
            </Card>
            <Hint>{t("products.extra.hint")}</Hint>
          </View>
        )}
      </Enter>
      {editing ? (
        <ExtraCostSheet
          editing={editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSave={async (input) =>
            editing.kind === "new"
              ? (await createExtraCost(project.id, input)).ok
              : (await updateExtraCost(project.id, editing.extra.id, input)).ok
          }
          onDelete={editing.kind === "edit" ? () => confirmDelete(editing.extra) : undefined}
        />
      ) : null}
    </Screen>
  );
}
