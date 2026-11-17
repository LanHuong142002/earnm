import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { useTheme } from "../../theme/useTheme";
import { PressableScale } from "../../ui/PressableScale";
import { formatCommentTime } from "../comments/commentTime";
import { useTasks } from "../TasksProvider";
import { CaptionSheet } from "./CaptionSheet";
import { afterDelete, overlayOf, viewerStart } from "./photoUi";
import type { Photo } from "./types";
import { useTaskPhotos } from "./useTaskPhotos";

/**
 * The full-screen viewer (mockups 3a to 3e): black, swipes between the task's photos, "n / total" on top, the
 * caption and who added the photo and when below. Involved people can edit the caption and delete.
 */
export function PhotoViewer({ projectId, taskId, photoId }: { projectId: string; taskId: string; photoId?: string }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { colors, typography, layout, spacing, iconSize, onFixed, viewer } = useTheme();
  const { identity } = useAuth();
  const { tasksFor } = useTasks();
  const task = tasksFor(projectId).find((x) => x.id === taskId) ?? null;
  const p = useTaskPhotos({ projectId, taskId, me: identity, task });
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<Photo>>(null);
  // Where the person swiped to; until then the tapped photo.
  const [picked, setIndex] = useState<number | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [captioning, setCaptioning] = useState(false);
  const [now] = useState(() => new Date());
  const lang = i18n.language === "vi" ? "vi" : "en";

  const total = p.photos.length;
  const ready = !p.loading && task !== null;

  // Nothing left to show (everything deleted here or elsewhere): close.
  useEffect(() => {
    if (ready && total === 0) router.back();
  }, [ready, total, router]);

  const startAt = viewerStart(p.photos, photoId);
  const at = Math.min(picked ?? startAt, Math.max(0, total - 1));
  const photo: Photo | undefined = p.photos[at];

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (width <= 0) return;
    setIndex(Math.max(0, Math.min(total - 1, Math.round(e.nativeEvent.contentOffset.x / width))));
  };

  const confirmDelete = () => {
    if (!photo) return;
    const local = photo.state !== "synced";
    Alert.alert(
      t(local ? "tasks.photos.deleteWaitingTitle" : "tasks.photos.deleteTitle"),
      t(local ? "tasks.photos.deleteWaitingMessage" : "tasks.photos.deleteMessage"),
      [
        { text: t("tasks.photos.cancel"), style: "cancel" },
        {
          text: t(local ? "tasks.photos.discard" : "tasks.photos.deleteConfirm"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              const result = await p.remove(photo.id);
              if (!result.ok) {
                Alert.alert(t(result.reason === "not_allowed" ? "tasks.photos.notAllowed" : "tasks.photos.notReady"));
                return;
              }
              const next = afterDelete(at, total);
              if (next === null) {
                router.back();
                return;
              }
              setIndex(next);
              requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: next * width, animated: false }));
            })();
          },
        },
      ],
    );
  };

  const saveCaption = async (value: string) => {
    if (!photo) return;
    setCaptioning(false);
    const result = await p.setCaption(photo.id, value);
    if (!result.ok) Alert.alert(t(result.reason === "not_allowed" ? "tasks.photos.notAllowed" : "tasks.photos.notReady"));
  };

  const close = (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={t("tasks.photos.close")}
      onPress={() => router.back()}
      style={{ width: layout.controlHeight, height: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
    >
      <Ionicons name="close" size={iconSize.lg} color={onFixed} />
    </PressableScale>
  );

  const secondary = { color: onFixed, opacity: 0.75 };
  const state = photo ? overlayOf(photo) : "none";

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1, backgroundColor: viewer.background }}>
      <StatusBar style="light" />
      <View style={{ flexDirection: "row", alignItems: "center", height: layout.controlHeight, paddingHorizontal: spacing[0] }}>
        <View style={{ width: layout.controlHeight }}>{close}</View>
        <Text
          accessibilityRole="header"
          accessibilityLabel={photo ? t("tasks.photos.positionA11y", { index: at + 1, total }) : t("tasks.photos.viewerTitle")}
          style={[typography.bodyStrong, { flex: 1, textAlign: "center", color: onFixed }]}
        >
          {photo ? t("tasks.photos.position", { index: at + 1, total }) : ""}
        </Text>
        <View style={{ width: layout.controlHeight }} />
      </View>

      <View style={{ flex: 1 }} onLayout={(e) => setPageHeight(e.nativeEvent.layout.height)}>
        {!ready || total === 0 || pageHeight === 0 ? (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator accessibilityLabel={t("tasks.photos.loadingViewerA11y")} color={onFixed} />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={p.photos}
            keyExtractor={(x) => x.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={at}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={onScrollEnd}
            renderItem={({ item, index: i }) => (
              <View style={{ width, height: pageHeight }}>
                <Image
                  source={{ uri: item.url }}
                  placeholder={{ uri: item.thumbUrl }}
                  cachePolicy="disk"
                  contentFit="contain"
                  accessibilityLabel={item.caption || t("tasks.photos.positionA11y", { index: i + 1, total })}
                  style={{ width, height: pageHeight }}
                />
              </View>
            )}
          />
        )}
      </View>

      {photo ? (
        <View style={{ paddingHorizontal: layout.screenPadding, paddingTop: spacing[2] }}>
          {photo.caption ? <Text style={[typography.body, { color: onFixed }]}>{photo.caption}</Text> : null}
          {p.canCaption(photo) ? (
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t(photo.caption ? "tasks.photos.editCaption" : "tasks.photos.addCaption")}
              onPress={() => setCaptioning(true)}
              style={{ minHeight: layout.controlHeight, justifyContent: "center", alignSelf: "flex-start" }}
            >
              <Text style={[typography.bodyStrong, { color: colors.accent }]}>
                {t(photo.caption ? "tasks.photos.editCaption" : "tasks.photos.addCaption")}
              </Text>
            </PressableScale>
          ) : null}
          {state !== "none" ? <Text style={[typography.label, secondary]}>{t(`tasks.photos.${state}`)}</Text> : null}
          <View style={{ flexDirection: "row", alignItems: "center", minHeight: layout.controlHeight }}>
            <Text style={[typography.label, secondary, { flex: 1 }]} numberOfLines={2}>
              {t("tasks.photos.addedBy", {
                name: photo.addedBy?.displayName ?? t("tasks.photos.formerMember"),
                time: formatCommentTime(photo.createdAt, now, lang, t),
              })}
            </Text>
            {p.canRemove(photo) ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t("tasks.photos.deleteA11y")}
                onPress={confirmDelete}
                style={{ width: layout.controlHeight, height: layout.controlHeight, alignItems: "center", justifyContent: "center" }}
              >
                <Ionicons name="trash-outline" size={iconSize.lg} color={onFixed} />
              </PressableScale>
            ) : null}
          </View>
        </View>
      ) : null}

      <CaptionSheet visible={captioning} initial={photo?.caption ?? ""} onCancel={() => setCaptioning(false)} onSave={(v) => void saveCaption(v)} />
    </SafeAreaView>
  );
}
