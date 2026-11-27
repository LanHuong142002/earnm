import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { CommentSourceLine } from "../../../../../../tasks/comments/CommentSourceLine";
import { ideaFromComment, readCommentSource } from "../../../../../../tasks/comments/commentSource";
import { emptyIdeaForm, inputFromIdeaForm } from "../../../../../../ideas/formState";
import { IdeaForm } from "../../../../../../ideas/IdeaForm";
import { useIdeas } from "../../../../../../ideas/IdeasProvider";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { projectView } from "../../../../../../projects/routing";
import { useTasks } from "../../../../../../tasks/TasksProvider";
import { useTheme } from "../../../../../../theme/useTheme";
import { Screen } from "../../../../../../ui/Screen";

export default function NewIdeaScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { colors, typography, spacing } = useTheme();
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const id = typeof params.id === "string" ? params.id : undefined;
  // Opened from a comment: its first sentence and text fill the fields once (they stay editable). Labels start empty.
  const source = useMemo(() => readCommentSource(params), [params]);
  const initial = useMemo(() => {
    if (!source) return emptyIdeaForm();
    const { title, description } = ideaFromComment(source);
    return { ...emptyIdeaForm(), title, description };
  }, [source]);
  const { status, projects } = useProjects();
  const { labelsFor } = useTasks();
  const { create } = useIdeas();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) {
    return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  }

  return (
    <IdeaForm
      initial={initial}
      header={source ? <CommentSourceLine source={source} /> : undefined}
      labels={labelsFor(project.id)}
      submitLabel={t("ideas.saveNew")}
      // An idea has to exist before photos can be added to it (they are uploaded against its id).
      photos={
        <View style={{ gap: spacing[0] }}>
          <Text style={[typography.label, { color: colors.text }]}>{t("ideas.photosLabel")}</Text>
          <Text style={[typography.body, { color: colors.textSecondary }]}>{t("ideas.photosAfterSave")}</Text>
        </View>
      }
      onSubmit={async (form) => {
        const result = await create(project.id, inputFromIdeaForm(form));
        // Back to the list the form was opened from; the filled-in form isn't left in the history.
        if (result.ok) router.back();
        return result;
      }}
    />
  );
}
