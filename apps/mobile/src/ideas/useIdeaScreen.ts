import { useIsFocused, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { useTranslation } from "react-i18next";

import { useAuth } from "../auth/AuthProvider";
import type { Project } from "../projects/api";
import { useProjects } from "../projects/ProjectsProvider";
import { useIdeas } from "./IdeasProvider";
import { canEditAs, ideaView } from "./screenView";
import type { Idea } from "./types";

/**
 * What the idea screen, Edit idea and the status sheet share: the idea from the route, leaving for the ideas list
 * when it is gone, whether this person may edit it, and delete.
 */
export function useIdeaScreen(projectId: string, ideaId: string) {
  const { t } = useTranslation();
  const router = useRouter();
  const focused = useIsFocused();
  // The saved identity counts while the profile request is pending, so Sửa and Xoá never wait on the network.
  const { identity } = useAuth();
  const { status, projects } = useProjects();
  const { ready, ideasFor, remove } = useIdeas();
  const [deleting, setDeleting] = useState(false);

  const project: Project | null = projects.find((p) => p.id === projectId) ?? null;
  const idea: Idea | null = ready ? (ideasFor(projectId).find((x) => x.id === ideaId) ?? null) : null;
  const view = ideaView({ projectFound: project !== null, projectsStatus: status, ideasReady: ready, ideaFound: idea !== null });
  const canEdit = idea !== null && canEditAs(idea, identity, project?.role ?? null);

  const goToList = () => router.dismissTo({ pathname: "/projects/[id]/ideas", params: { id: projectId } });

  // Gone (deleted elsewhere, or refused as not found): to the ideas list. Not while deleting here, which navigates itself.
  useEffect(() => {
    if (view === "leave" && focused && !deleting) router.dismissTo({ pathname: "/projects/[id]/ideas", params: { id: projectId } });
  }, [view, focused, deleting, router, projectId]);

  function confirmDelete() {
    if (!idea) return;
    Alert.alert(t("ideas.deleteTitle", { title: idea.title }), t("ideas.deleteMessage"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("ideas.deleteConfirm"),
        style: "destructive",
        onPress: () => {
          setDeleting(true);
          void (async () => {
            try {
              await remove(projectId, idea.id);
              // To the list; nothing of the deleted idea stays in the history.
              goToList();
            } catch {
              setDeleting(false);
              Alert.alert(t("errors.generic"));
            }
          })();
        },
      },
    ]);
  }

  return { project, idea, view, deleting, canEdit, identity, confirmDelete };
}
