import { Image } from "expo-image";
import { View } from "react-native";

import { useAuth } from "../auth/AuthProvider";
import { useProjects } from "../projects/ProjectsProvider";
import { useParentPhotos } from "../tasks/photos/useParentPhotos";
import { useTheme } from "../theme/useTheme";
import { ideaParent } from "./adapters";
import type { Idea } from "./types";

/** The side of a small thumbnail on the New draft form (mockup B2). */
const SMALL = 48;

/** A row of small, read-only thumbnails of an idea's photos: the ones that will be copied into the new draft. */
export function IdeaPhotoStrip({ projectId, idea }: { projectId: string; idea: Idea }) {
  const { colors, radius, spacing } = useTheme();
  const { identity } = useAuth();
  const { projects } = useProjects();
  const role = projects.find((p) => p.id === projectId)?.role ?? null;
  const p = useParentPhotos({ parent: ideaParent(projectId, idea.id, idea, identity?.id ?? null, role), me: identity });
  const shown = p.photos.filter((x) => x.thumbUrl).slice(0, 6);
  if (shown.length === 0) return null;
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", gap: spacing[0], flexWrap: "wrap" }}>
      {shown.map((photo) => (
        <View key={photo.id} style={{ width: SMALL, height: SMALL, borderRadius: radius.tile, overflow: "hidden", backgroundColor: colors.field }}>
          <Image source={{ uri: photo.thumbUrl }} cachePolicy="disk" contentFit="cover" transition={0} style={{ width: SMALL, height: SMALL }} />
        </View>
      ))}
    </View>
  );
}
