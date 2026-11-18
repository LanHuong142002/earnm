import { Ionicons } from "@expo/vector-icons";
import { useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { getToken } from "../../../../../../auth/token-store";
import { useIdeas } from "../../../../../../ideas/IdeasProvider";
import { createTaskFromIdea } from "../../../../../../ideas/api";
import { createTaskErrorKey, prefilledTaskForm } from "../../../../../../ideas/taskPrefill";
import { ApiError } from "../../../../../../lib/api";
import { useGoToProjectList } from "../../../../../../projects/useProjectNav";
import { newProjectId } from "../../../../../../projects/newProjectId";
import { useProjects } from "../../../../../../projects/ProjectsProvider";
import { projectView } from "../../../../../../projects/routing";
import { emptyForm, inputFromForm } from "../../../../../../tasks/formState";
import { LabelChip } from "../../../../../../tasks/LabelChip";
import { TaskForm } from "../../../../../../tasks/TaskForm";
import { useTasks } from "../../../../../../tasks/TasksProvider";
import { useTheme } from "../../../../../../theme/useTheme";
import { Button } from "../../../../../../ui/Button";
import { ErrorText } from "../../../../../../ui/ErrorText";
import { Screen } from "../../../../../../ui/Screen";
import { TextField } from "../../../../../../ui/TextField";

export default function NewTaskScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const goToList = useGoToProjectList();
  const focused = useIsFocused();
  const { id, fromIdea } = useLocalSearchParams<{ id: string; fromIdea?: string }>();
  const { status, projects } = useProjects();
  const { create } = useTasks();
  const project = projects.find((p) => p.id === id) ?? null;
  const view = projectView(project, status, false);

  useEffect(() => {
    if (view === "leave" && focused) goToList();
  }, [view, focused, goToList]);

  if (!project) {
    return <Screen edges={[]}>{view === "loading" ? <View /> : null}</Screen>;
  }

  if (fromIdea) return <NewTaskFromIdea projectId={project.id} ideaId={fromIdea} />;

  return (
    <TaskForm
      projectId={project.id}
      initial={emptyForm()}
      showStatus={false}
      submitLabel={t("tasks.saveButton")}
      onSubmit={async (form) => {
        const result = await create(project.id, inputFromForm(form));
        // Back to the list the form was opened from; the filled-in form isn't left in the history.
        if (result.ok) router.back();
        return result;
      }}
    />
  );
}

/**
 * New task opened from an accepted idea (mockup 2d): the idea's title, description and labels as the task will be
 * saved, with the line "Từ ý tưởng “…”". The server makes the task from the idea, in one step with the back-link,
 * so it needs the network and nothing is queued. Then the form is replaced by the new task, so back returns to the idea.
 */
function NewTaskFromIdea({ projectId, ideaId }: { projectId: string; ideaId: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { colors, typography, spacing, iconSize } = useTheme();
  const { ready, ideasFor, refresh: refreshIdeas } = useIdeas();
  const { refresh: refreshTasks, labelsFor } = useTasks();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // One task id per opening of the form: pressing the button again after a lost answer cannot make two tasks.
  const taskId = useRef(newProjectId()).current;

  const idea = ready ? (ideasFor(projectId).find((x) => x.id === ideaId) ?? null) : null;
  // The idea is gone (deleted meanwhile): nothing to make a task from.
  useEffect(() => {
    if (ready && idea === null) router.back();
  }, [ready, idea, router]);

  if (!idea) return <Screen edges={[]}>{null}</Screen>;
  const form = prefilledTaskForm(idea, labelsFor(projectId));

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new ApiError("not_signed_in", 401);
      await createTaskFromIdea(token, projectId, ideaId, taskId);
      // Fetch the new task and the idea's link so both screens know them before we open the task.
      await Promise.all([refreshTasks(projectId), refreshIdeas(projectId)]).catch(() => undefined);
      router.replace({ pathname: "/projects/[id]/tasks/[taskId]", params: { id: projectId, taskId } });
    } catch (e) {
      setError(createTaskErrorKey(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen edges={[]} footer={<Button label={t("ideas.createTask.button")} loading={busy} onPress={submit} />}>
      <View style={{ gap: spacing[2] }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[0] }}>
          <Ionicons name="bulb-outline" size={iconSize.sm} color={colors.textSecondary} />
          <Text style={[typography.label, { flex: 1, color: colors.textSecondary }]}>
            {t("ideas.createTask.fromLine", { title: form.ideaTitle })}
          </Text>
        </View>
        <TextField label={t("tasks.titleLabel")} icon="checkbox-outline" value={form.title} editable={false} />
        <TextField
          label={t("tasks.descriptionOptional")}
          icon="document-text-outline"
          value={form.description}
          editable={false}
          multiline
        />
        <View style={{ gap: spacing[0] }}>
          <Text style={[typography.label, { color: colors.text }]}>{t("tasks.labelsField.label")}</Text>
          {form.labels.length === 0 ? (
            <Text style={[typography.body, { color: colors.textSecondary }]}>{t("tasks.labelsField.none")}</Text>
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing[0] + 2 }}>
              {form.labels.map((label) => (
                <LabelChip key={label.id} label={label} size="md" />
              ))}
            </View>
          )}
        </View>
        {error ? <ErrorText message={t(error)} /> : null}
      </View>
    </Screen>
  );
}
