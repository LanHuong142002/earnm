import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { formatPriceText, moneyOf } from "../../../../../../ingredients/display";
import type { Currency } from "../../../../../../lib/currency";
import { OfflineNote } from "../../../../../../projects/OfflineNote";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { useGoToProjectList, useTapOnce } from "../../../../../../projects/useProjectNav";
import { projectView } from "../../../../../../projects/routing";
import { CupsSheet } from "../../../../../../products/CupsSheet";
import { monthlyAmount } from "../../../../../../products/fixedCost";
import { Hint, LinkRow } from "../../../../../../products/ProductBits";
import { ProductRejectedNotice } from "../../../../../../products/ProductRejectedNotice";
import { useProducts } from "../../../../../../products/ProductsProvider";
import type { FixedCost } from "../../../../../../products/types";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { Card } from "../../../../../../ui/Card";
import { Collapsible } from "../../../../../../ui/Collapsible";
import { Enter } from "../../../../../../ui/Enter";
import { HeroCard } from "../../../../../../ui/HeroCard";
import { PressableScale } from "../../../../../../ui/PressableScale";
import { Screen } from "../../../../../../ui/Screen";

type Load = "loading" | "ok" | "error";

function Skeleton({ height }: { height: number }) {
  const { colors, radius } = useTheme();
  return <View style={{ height, borderRadius: radius.card, backgroundColor: colors.field }} />;
}

/** The orange card: the monthly total and, with cups set, the cups and what each cup carries (mockups 1b, 1i). */
function Hero({ total, cups, share, currency }: { total: number; cups: number | null; share: number | null; currency: Currency }) {
  const { t } = useTranslation();
  const label = t("fixedCosts.heroLabel");
  return (
    <HeroCard
      label={label}
      value={moneyOf(total, currency)}
      sub={t(cups === null ? "fixedCosts.heroSubNoCups" : "fixedCosts.heroSub")}
      accessibilityLabel={`${label}, ${moneyOf(total, currency)}`}
      cells={
        cups !== null && share !== null
          ? [
              { label: t("fixedCosts.cupsCell"), value: t("fixedCosts.cupsValue", { amount: formatPriceText(String(cups), "VND") }) },
              { label: t("fixedCosts.shareCell"), value: moneyOf(share, currency) },
            ]
          : undefined
      }
    />
  );
}

export default function FixedCostsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const once = useTapOnce();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { colors, typography, radius, spacing, layout } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { status, projects } = useProjects();
  const {
    ready,
    refresh,
    fixedCostsFor,
    fixedCostPendingFor,
    expectedCupsFor,
    expectedCupsPendingFor,
    fixedTotalFor,
    perCupShareFor,
    productsFor,
    setExpectedCups,
  } = useProducts();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);
  const [load, setLoad] = useState<Load>("loading");
  const [cupsOpen, setCupsOpen] = useState(false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  const fetchAll = useCallback(() => {
    if (!ready || !id) return;
    void refresh(id)
      .then((result) => {
        if (result === "ok") setLoad("ok");
        else if (result !== "skipped") setLoad("error");
      })
      .catch(() => setLoad("error"));
  }, [ready, refresh, id]);

  useFocusEffect(fetchAll);

  const addItem = () => once(() => router.push({ pathname: "/projects/[id]/fixed-costs/new", params: { id: id as string } }));
  const openItem = (fixedCostId: string) =>
    once(() => router.push({ pathname: "/projects/[id]/fixed-costs/[fixedCostId]", params: { id: id as string, fixedCostId } }));

  if (!project) return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;

  const currency = project.currency;
  const list: FixedCost[] = ready ? fixedCostsFor(project.id) : [];
  const pending = fixedCostPendingFor(project.id);
  const cups = ready ? expectedCupsFor(project.id) : null;
  const total = fixedTotalFor(project.id);
  const share = perCupShareFor(project.id);
  const nothingKnown = list.length === 0 && cups === null;
  const loadingNow = !ready || (load === "loading" && nothingKnown);
  const failedNow = load === "error" && nothingKnown;

  const detailOf = (item: FixedCost) =>
    item.kind === "monthly"
      ? t("fixedCosts.detailMonthly")
      : item.kind === "weekly"
        ? t("fixedCosts.detailWeekly", { amount: moneyOf(item.amount, currency) })
        : t("fixedCosts.detailOneTime", { amount: moneyOf(item.amount, currency), months: item.months ?? 0 });

  return (
    <Screen edges={[]}>
      <Stack.Screen
        options={{
          headerRight: () =>
            loadingNow || failedNow ? null : (
              <PressableScale
                accessibilityRole="link"
                accessibilityLabel={t("fixedCosts.addA11y")}
                onPress={addItem}
                style={{ minHeight: layout.controlHeight, justifyContent: "center", paddingHorizontal: spacing[1] }}
              >
                <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("fixedCosts.addLink")}</Text>
              </PressableScale>
            ),
        }}
      />
      <OfflineNote />
      <ProductRejectedNotice />
      <Enter index={1}>
        {loadingNow ? (
          <View accessible accessibilityLabel={t("fixedCosts.loading")} style={{ gap: spacing[2] }}>
            <Skeleton height={150} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </View>
        ) : failedNow ? (
          <View style={{ gap: spacing[2] }}>
            <View
              accessibilityRole="alert"
              style={{ padding: spacing[2], borderRadius: radius.card, backgroundColor: colors.dangerBg }}
            >
              <Text style={[typography.bodyStrong, { color: colors.danger }]}>{t("fixedCosts.loadError")}</Text>
            </View>
            <Button label={t("fixedCosts.loadRetry")} variant="secondary" onPress={fetchAll} />
          </View>
        ) : list.length === 0 ? (
          <View style={{ alignItems: "center", gap: spacing[1], paddingTop: spacing[5] }}>
            <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text, textAlign: "center" }]}>
              {t("fixedCosts.emptyTitle")}
            </Text>
            <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center" }]}>{t("fixedCosts.emptyBody")}</Text>
            <Button label={t("fixedCosts.emptyAdd")} variant="secondary" onPress={addItem} />
          </View>
        ) : (
          <View style={{ gap: spacing[2] }}>
            <Hero total={total} cups={cups} share={share} currency={currency} />
            <Card flush>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("fixedCosts.cupsRowA11y", {
                  value: cups === null ? t("fixedCosts.cupsEnter") : formatPriceText(String(cups), "VND"),
                })}
                onPress={() => setCupsOpen(true)}
                style={{
                  minHeight: layout.controlHeight + spacing[2],
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: spacing[1],
                  paddingHorizontal: spacing[2],
                }}
              >
                <Text style={[typography.body, { color: colors.text, flexShrink: 1 }]}>{t("fixedCosts.cupsRow")}</Text>
                <Text style={[typography.bodyStrong, { color: cups === null ? colors.accentStrong : colors.text }]}>
                  {cups === null ? t("fixedCosts.cupsEnter") : formatPriceText(String(cups), "VND")}
                  {expectedCupsPendingFor(project.id) ? ` · ${t("products.pending")}` : ""}
                </Text>
              </PressableScale>
            </Card>
            <Card>
              <Collapsible title={t("fixedCosts.itemsTitle", { count: list.length })} trailing={moneyOf(total, currency)}>
                <View>
                  {list.map((item, index) => {
                    const isPending = pending.has(item.id);
                    const detail = detailOf(item);
                    const monthly = moneyOf(monthlyAmount(item), currency);
                    return (
                      <PressableScale
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={[t("fixedCosts.rowA11y", { name: item.name, detail, monthly }), isPending ? t("products.pending") : null]
                          .filter(Boolean)
                          .join(", ")}
                        onPress={() => openItem(item.id)}
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: spacing[1],
                          minHeight: layout.controlHeight + spacing[2],
                          paddingVertical: spacing[1],
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                          marginTop: index === 0 ? spacing[0] : 0,
                        }}
                      >
                        <View style={{ flex: 1, gap: spacing[0] / 2 }}>
                          <Text style={[typography.bodyStrong, { color: colors.text }]}>{item.name}</Text>
                          <Text style={[typography.caption, { color: colors.textSecondary }]}>
                            {detail}
                            {isPending ? ` · ${t("products.pending")}` : ""}
                          </Text>
                        </View>
                        <Text style={[typography.bodyStrong, { color: colors.text }]}>{monthly}</Text>
                      </PressableScale>
                    );
                  })}
                  <LinkRow divider label={t("fixedCosts.addItem")} onPress={addItem} />
                  <Hint>{t("fixedCosts.listHint")}</Hint>
                </View>
              </Collapsible>
            </Card>
            {share !== null ? <Hint>{t("fixedCosts.shareHint")}</Hint> : null}
          </View>
        )}
      </Enter>
      {cupsOpen ? (
        <CupsSheet
          initial={cups}
          total={total}
          currency={currency}
          productCount={productsFor(project.id).length}
          onClose={() => setCupsOpen(false)}
          onSave={async (value) => (await setExpectedCups(project.id, value)).ok}
        />
      ) : null}
    </Screen>
  );
}
