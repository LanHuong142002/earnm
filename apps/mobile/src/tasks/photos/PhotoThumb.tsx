import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { ActivityIndicator, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/useTheme";
import { PressableScale } from "../../ui/PressableScale";
import { overlayOf, thumbLabelKey } from "./photoUi";
import type { Photo } from "./types";

/** The thumbnail side, a fixed square so the grid never jumps while pictures load (spec R28). */
export const THUMB = 72;

/**
 * One square thumbnail. A photo still on the phone shows its state over the picture, always with text as well as
 * the icon: "Đang tải" with a spinner, "Chờ mạng" with a clock, "Lỗi · chạm để thử lại" for a refused one.
 * The 8th tile of a longer list shows "+N" instead.
 */
export function PhotoThumb({
  photo,
  index,
  total,
  overflow = 0,
  onPress,
}: {
  photo: Photo;
  /** 1-based position among all the task's photos, for the accessible name. */
  index: number;
  total: number;
  /** The N of "+N"; 0 for an ordinary tile. */
  overflow?: number;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors, typography, radius, spacing, iconSize, onFixed, viewer } = useTheme();
  const overlay = overlayOf(photo);
  const label =
    overflow > 0
      ? t("tasks.photos.moreA11y", { count: overflow })
      : t(thumbLabelKey(photo), { index, total, caption: photo.caption });

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{ width: THUMB, height: THUMB, borderRadius: radius.tile, overflow: "hidden", backgroundColor: colors.field }}
    >
      <Image
        source={{ uri: photo.thumbUrl }}
        cachePolicy="disk"
        contentFit="cover"
        transition={0}
        accessible={false}
        style={{ width: THUMB, height: THUMB }}
      />
      {overlay !== "none" || overflow > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: viewer.scrim,
            alignItems: "center",
            justifyContent: "center",
            gap: spacing[0],
            padding: spacing[0],
          }}
        >
          {overflow > 0 && overlay === "none" ? (
            <Text style={[typography.sectionTitle, { color: onFixed }]}>{t("tasks.photos.more", { count: overflow })}</Text>
          ) : (
            <>
              {overlay === "uploading" ? <ActivityIndicator color={onFixed} /> : null}
              {overlay === "waiting" ? <Ionicons name="time-outline" size={iconSize.sm} color={onFixed} /> : null}
              {overlay === "failed" ? <Ionicons name="alert-circle-outline" size={iconSize.sm} color={onFixed} /> : null}
              <Text style={[typography.caption, { color: onFixed, textAlign: "center" }]} numberOfLines={2}>
                {t(`tasks.photos.${overlay}`)}
              </Text>
            </>
          )}
        </View>
      ) : null}
    </PressableScale>
  );
}
