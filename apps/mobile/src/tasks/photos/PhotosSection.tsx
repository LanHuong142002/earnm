import { useState } from "react";
import { ActionSheetIOS, Alert, Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../../auth/AuthProvider";
import { useTheme } from "../../theme/useTheme";
import { Button } from "../../ui/Button";
import { ErrorText } from "../../ui/ErrorText";
import { PressableScale } from "../../ui/PressableScale";
import type { Parent } from "../parent";
import { addNotice, overlayOf, type PickSource } from "./photoUi";
import { PhotoThumb } from "./PhotoThumb";
import type { Photo } from "./types";
import { usePhotoPicker } from "./usePhotoPicker";
import { useParentPhotos } from "./useParentPhotos";
import { PHOTO_MAX } from "./view";

type Choice = { label: string; destructive?: boolean; onPress: () => void };

/** A native choice list: the iOS action sheet, an alert elsewhere. "Huỷ" is added last. */
function showChoices(title: string, choices: Choice[], cancel: string) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...choices.map((c) => c.label), cancel],
        cancelButtonIndex: choices.length,
        destructiveButtonIndex: choices.findIndex((c) => c.destructive) >= 0 ? choices.findIndex((c) => c.destructive) : undefined,
      },
      (index) => choices[index]?.onPress(),
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...choices.map((c) => ({ text: c.label, style: c.destructive ? ("destructive" as const) : ("default" as const), onPress: c.onPress })),
    { text: cancel, style: "cancel" as const },
  ]);
}

/** The Ảnh section of a task or idea screen: count, add, a four-per-row grid of thumbnails, and the viewer behind each (`onOpenPhoto` opens it). */
export function PhotosSection({ parent, onOpenPhoto }: { parent: Parent; onOpenPhoto: (photoId: string) => void }) {
  const { t } = useTranslation();
  const { colors, typography, layout, radius, spacing, disabled } = useTheme();
  const { identity } = useAuth();
  const p = useParentPhotos({ parent, me: identity });
  const picker = usePhotoPicker(p.freePlaces);
  const [notice, setNotice] = useState<string | null>(null);

  if (!p.showSection) return null;

  const failedCount = p.photos.filter((x) => overlayOf(x) === "failed").length;
  const empty = !p.loading && !p.unavailable && p.photos.length === 0;

  const run = async (source: PickSource) => {
    setNotice(null);
    const picked = await picker.pick(source);
    if (picked.length === 0) return;
    const message = addNotice(await p.add(picked));
    if (message) setNotice(t(message.key, { count: message.count }));
  };

  const openAdd = () => {
    if (p.addState !== "open") return;
    showChoices(
      t("tasks.photos.addTitle", { count: p.freePlaces }),
      [
        { label: t("tasks.photos.takePhoto"), onPress: () => void run("camera") },
        { label: t("tasks.photos.chooseLibrary"), onPress: () => void run("library") },
      ],
      t("tasks.photos.cancel"),
    );
  };

  const openViewer = (photo: Photo) => onOpenPhoto(photo.id);

  const onThumb = (photo: Photo) => {
    if (overlayOf(photo) !== "failed") {
      openViewer(photo);
      return;
    }
    showChoices(
      t("tasks.photos.failedSheetTitle"),
      [
        { label: t("tasks.photos.retry"), onPress: () => void p.retry(photo.id) },
        { label: t("tasks.photos.discard"), destructive: true, onPress: () => void p.discard(photo.id) },
      ],
      t("tasks.photos.cancel"),
    );
  };

  const full = p.addState === "full";

  return (
    <View style={{ gap: spacing[2] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[2] }}>
        <Text accessibilityRole="header" style={[typography.sectionTitle, { color: colors.text }]}>
          {t("tasks.photos.heading")}
        </Text>
        {p.photos.length > 0 || p.involved ? (
          <Text
            accessibilityLabel={t("tasks.photos.countA11y", { count: p.count })}
            style={[typography.label, { flex: 1, color: colors.textSecondary }]}
          >
            {`${p.count}/${PHOTO_MAX}`}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {p.addState !== "hidden" && !empty ? (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t("tasks.photos.addA11y")}
            accessibilityState={{ disabled: full }}
            disabled={full}
            onPress={openAdd}
            style={{
              minHeight: layout.controlHeight,
              minWidth: layout.controlHeight,
              justifyContent: "center",
              opacity: full ? disabled.opacity : 1,
            }}
          >
            <Text style={[typography.bodyStrong, { color: colors.accentStrong }]}>{t("tasks.photos.add")}</Text>
          </PressableScale>
        ) : null}
      </View>

      {p.unavailable ? <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.photos.unavailable")}</Text> : null}

      {p.loading ? (
        <View accessible accessibilityLabel={t("tasks.photos.loadingA11y")} style={{ flexDirection: "row", gap: spacing[1] }}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              importantForAccessibility="no-hide-descendants"
              style={{ width: 72, height: 72, borderRadius: radius.tile, backgroundColor: colors.field }}
            />
          ))}
        </View>
      ) : null}

      {p.offline ? <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.photos.offline")}</Text> : null}

      {empty && !p.offline ? (
        <>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.photos.emptyBody")}</Text>
          {p.addState !== "hidden" ? <Button variant="secondary" label={t("tasks.photos.emptyAdd")} onPress={openAdd} /> : null}
        </>
      ) : null}

      {p.grid.tiles.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[1] }}>
          {p.grid.tiles.map((photo, i) => {
            const last = i === p.grid.tiles.length - 1;
            return (
              <PhotoThumb
                key={photo.id}
                photo={photo}
                index={i + 1}
                total={p.photos.length}
                overflow={last ? p.grid.overflow : 0}
                onPress={() => onThumb(photo)}
              />
            );
          })}
        </View>
      ) : null}

      {failedCount > 0 ? <ErrorText message={t("tasks.photos.failedLine", { count: failedCount })} /> : null}
      {full ? <Text style={[typography.caption, { color: colors.textSecondary }]}>{t("tasks.photos.fullLine")}</Text> : null}
      {notice ? <ErrorText message={notice} /> : null}
      {picker.problemKey ? (
        <>
          <ErrorText message={t(picker.problemKey, { app: t("common.appName") })} />
          <Button variant="secondary" label={t("tasks.photos.openSettings")} onPress={picker.openSettings} />
        </>
      ) : null}
    </View>
  );
}
