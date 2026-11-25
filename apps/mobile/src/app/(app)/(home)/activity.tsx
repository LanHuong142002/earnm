import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useMemo } from "react";
import { ActivityIndicator, SectionList, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useActivity } from "../../../activity/ActivityProvider";
import type { ActivityItem } from "../../../activity/api";
import { activityIcon, metaLine, rowText, sectionsOf, type Translate } from "../../../activity/format";
import { useOpenActivity } from "../../../activity/useOpenActivity";
import { useTheme } from "../../../theme/useTheme";
import { Button } from "../../../ui/Button";
import { ErrorText } from "../../../ui/ErrorText";
import { PressableScale } from "../../../ui/PressableScale";

const TILE = 40;
const DOT = 8;
const SKELETON_ROWS = 5;

const Row = memo(function Row({
  item,
  now,
  t,
  onOpen,
}: {
  item: ActivityItem;
  now: Date;
  t: Translate;
  onOpen: (item: ActivityItem) => void;
}) {
  const { colors, typography, radius, spacing, iconSize } = useTheme();
  const text = rowText(item, t);
  const meta = metaLine(item, now, t);
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t(item.read ? "activity.rowLabel" : "activity.rowLabelUnread", { text, meta })}
      onPress={() => onOpen(item)}
      style={{ minHeight: 60, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: spacing[2] }}
    >
      <View
        style={{
          width: TILE,
          height: TILE,
          borderRadius: radius.field,
          borderWidth: 1,
          borderColor: colors.tileBorder,
          backgroundColor: colors.tile,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={activityIcon(item.type)} size={iconSize.md} color={colors.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[item.read ? typography.body : typography.bodyStrong, { color: colors.text }]}>{text}</Text>
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{meta}</Text>
      </View>
      {item.read ? null : (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.accent }}
        />
      )}
    </PressableScale>
  );
});

function Skeleton() {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  const bar = (width: `${number}%`, height: number) => (
    <View style={{ width, height, borderRadius: radius.field / 2, backgroundColor: colors.field }} />
  );
  return (
    <View accessible accessibilityLabel={t("common.loading")} accessibilityRole="progressbar">
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {Array.from({ length: SKELETON_ROWS }, (_, i) => (
          <View key={i} style={{ minHeight: 60, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
            <View style={{ width: TILE, height: TILE, borderRadius: radius.field, backgroundColor: colors.field }} />
            <View style={{ flex: 1, gap: spacing[1] }}>
              {bar(i % 2 === 0 ? "80%" : "65%", 14)}
              {bar("40%", 10)}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function Empty({ onHome }: { onHome: () => void }) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing } = useTheme();
  return (
    <View style={{ alignItems: "center", gap: spacing[2], paddingTop: spacing[6] }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: radius.tile,
          borderWidth: 1,
          borderColor: colors.tileBorder,
          backgroundColor: colors.tile,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="notifications-outline" size={26} color={colors.accent} />
      </View>
      <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text, textAlign: "center" }]}>
        {t("activity.empty.title")}
      </Text>
      <Text style={[typography.body, { color: colors.textSecondary, textAlign: "center" }]}>{t("activity.empty.body")}</Text>
      <View style={{ alignSelf: "stretch", paddingTop: spacing[1] }}>
        <Button label={t("activity.empty.home")} variant="secondary" onPress={onHome} />
      </View>
    </View>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const { colors, radius, spacing } = useTheme();
  return (
    <View style={{ backgroundColor: colors.dangerBg, borderRadius: radius.card, padding: spacing[3], gap: spacing[2] }}>
      <ErrorText message={t("activity.error.message")} />
      <Button label={t("activity.error.retry")} variant="secondary" onPress={onRetry} />
    </View>
  );
}

export default function ActivityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, layout, spacing, iconSize } = useTheme();
  const { status, items, offline, hasMore, loadingMore, refresh, loadMore } = useActivity();
  const open = useOpenActivity();
  const tr = useCallback<Translate>((key, options) => t(key, options ?? {}) as string, [t]);

  // The first page is fetched each time the screen comes to the front; the saved copy shows meanwhile.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // "Now" is taken again whenever the rows change, so "2 phút trước" is current when the list is.
  const { now, sections } = useMemo(() => {
    const at = new Date();
    return {
      now: at,
      sections: sectionsOf(items, at).map((s) => ({ key: s.group, title: t(`activity.groups.${s.group}`), data: s.items })),
    };
  }, [items, t]);
  const goHome = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/")), [router]);

  const showSkeleton = items.length === 0 && (status === "idle" || status === "loading");
  const showError = items.length === 0 && status === "error";
  const showEmpty = items.length === 0 && status === "ready";

  const header = offline ? (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[1], paddingBottom: spacing[2] }}>
      <Ionicons name="cloud-offline-outline" size={iconSize.sm} color={colors.textSecondary} />
      <Text style={[typography.label, { color: colors.textSecondary }]}>{t("home.offline")}</Text>
    </View>
  ) : null;

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <SectionList
        style={styles.flex}
        contentContainerStyle={{ paddingHorizontal: layout.screenPadding, paddingTop: spacing[3], paddingBottom: layout.sectionGap }}
        sections={showSkeleton || showError || showEmpty ? [] : sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <>
            {header}
            {showSkeleton ? <Skeleton /> : null}
            {showError ? <LoadError onRetry={() => void refresh()} /> : null}
            {showEmpty ? <Empty onHome={goHome} /> : null}
          </>
        }
        renderSectionHeader={({ section }) => (
          <Text
            accessibilityRole="header"
            style={[typography.label, { color: colors.textSecondary, paddingTop: spacing[2], paddingBottom: spacing[0] }]}
          >
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => <Row item={item} now={now} t={tr} onOpen={open} />}
        onEndReached={() => {
          if (hasMore) void loadMore();
        }}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          loadingMore ? <ActivityIndicator accessibilityLabel={t("activity.loadingMore")} color={colors.textSecondary} /> : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({ flex: { flex: 1 } });
