import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { ideaParent } from "../../../../../../../ideas/adapters";
import { ideaFormFromIdea } from "../../../../../../../ideas/formState";
import { IdeaForm } from "../../../../../../../ideas/IdeaForm";
import { useIdeas } from "../../../../../../../ideas/IdeasProvider";
import { useIdeaScreen } from "../../../../../../../ideas/useIdeaScreen";
import { PhotosSection } from "../../../../../../../tasks/photos/PhotosSection";
import { useTasks } from "../../../../../../../tasks/TasksProvider";
import { Button } from "../../../../../../../ui/Button";
import { Screen } from "../../../../../../../ui/Screen";

/** Edit idea (mockup 3b): title, description, labels and photos, and the delete button, for the author and Owners. */
export default function EditIdeaScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id, ideaId } = useLocalSearchParams<{ id: string; ideaId: string }>();
  const { labelsFor } = useTasks();
  const { update } = useIdeas();
  const { project, idea, view, deleting, canEdit, identity, confirmDelete } = useIdeaScreen(id, ideaId);

  // Someone who may not edit has no business here (a deep link, or their role changed): back to the idea.
  useEffect(() => {
    if (view === "ready" && !canEdit && !deleting) router.back();
  }, [view, canEdit, deleting, router]);

  // While deleting, the idea vanishes from the list; don't redirect before we navigate.
  if (deleting) return null;
  if (!project || !idea || !canEdit) {
    return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  }

  const parent = ideaParent(project.id, idea.id, idea, identity?.id ?? null, project.role);

  return (
    <IdeaForm
      initial={ideaFormFromIdea(idea)}
      labels={labelsFor(project.id)}
      submitLabel={t("ideas.save")}
      photos={
        <PhotosSection
          parent={parent}
          onOpenPhoto={(photoId) =>
            router.push({ pathname: "/projects/[id]/ideas/[ideaId]/photos", params: { id: project.id, ideaId: idea.id, photoId } })
          }
        />
      }
      extra={<Button label={t("ideas.deleteButton")} variant="danger" onPress={confirmDelete} />}
      onSubmit={async (_form, changed) => {
        const result = await update(project.id, idea.id, changed);
        // Back to the idea the form was opened from.
        if (result.ok) router.back();
        return result;
      }}
    />
  );
}
