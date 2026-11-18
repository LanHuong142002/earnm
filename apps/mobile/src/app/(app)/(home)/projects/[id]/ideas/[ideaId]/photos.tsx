import { useLocalSearchParams } from "expo-router";

import { ideaParent } from "../../../../../../../ideas/adapters";
import { useIdeas } from "../../../../../../../ideas/IdeasProvider";
import { useProjects } from "../../../../../../../projects/ProjectsProvider";
import { useAuth } from "../../../../../../../auth/AuthProvider";
import { PhotoViewer } from "../../../../../../../tasks/photos/PhotoViewer";

/** The full-screen photo viewer of an idea, opened at `photoId`. */
export default function IdeaPhotosScreen() {
  const { id, ideaId, photoId } = useLocalSearchParams<{ id: string; ideaId: string; photoId?: string }>();
  const { identity } = useAuth();
  const { projects } = useProjects();
  const { ready, ideasFor } = useIdeas();
  const idea = ready ? (ideasFor(id).find((x) => x.id === ideaId) ?? null) : null;
  const role = projects.find((p) => p.id === id)?.role ?? null;
  return <PhotoViewer parent={ideaParent(id, ideaId, idea, identity?.id ?? null, role)} parentKnown={idea !== null} photoId={photoId} />;
}
