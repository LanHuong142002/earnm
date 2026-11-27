import { useLocalSearchParams } from "expo-router";

import { useAuth } from "../../../../../../../auth/AuthProvider";
import { draftParent } from "../../../../../../../drafts/adapters";
import { useDrafts } from "../../../../../../../drafts/DraftsProvider";
import { useProjects } from "../../../../../../../projects/ProjectsProvider";
import { PhotoViewer } from "../../../../../../../tasks/photos/PhotoViewer";

/** The full-screen photo viewer of a draft, opened at `photoId`. */
export default function DraftPhotosScreen() {
  const { id, draftId, photoId } = useLocalSearchParams<{ id: string; draftId: string; photoId?: string }>();
  const { identity } = useAuth();
  const { projects } = useProjects();
  const { ready, draftsFor } = useDrafts();
  const draft = ready ? (draftsFor(id).find((x) => x.id === draftId) ?? null) : null;
  const role = projects.find((p) => p.id === id)?.role ?? null;
  return <PhotoViewer parent={draftParent(id, draftId, draft, identity?.id ?? null, role)} parentKnown={draft !== null} photoId={photoId} />;
}
