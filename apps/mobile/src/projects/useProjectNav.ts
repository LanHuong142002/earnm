import { useNavigation, useRouter } from "expo-router";
import { useCallback, useRef } from "react";

import { useProjects } from "./ProjectsProvider";
import { createTapGuard, stepsToList } from "./listNav";

type StackNavigation = {
  getState(): { routes: { name: string }[] } | undefined;
  dispatch(action: object): void;
};

/** Go to the Project list without ever leaving a duplicate of it or a deleted project's screens (see stepsToList). */
export function useGoToProjectList(): () => void {
  const navigation = useNavigation<StackNavigation>();
  return useCallback(
    () => {
      const names = navigation.getState()?.routes.map((r) => r.name) ?? [];
      for (const step of stepsToList(names)) navigation.dispatch(step);
    },
    [navigation],
  );
}

/** Wraps a navigation so a quick double tap runs it once. */
export function useTapOnce(): (go: () => void) => void {
  const guard = useRef(createTapGuard()).current;
  return (go) => {
    if (guard.allow()) go();
  };
}

/** Open a project's screen and make it the current project. Pushes first, saves the choice in the background; a quick double tap runs once. */
export function useOpenProject(): (id: string) => void {
  const router = useRouter();
  const once = useTapOnce();
  const { setCurrentProject } = useProjects();
  return (id) =>
    once(() => {
      router.push({ pathname: "/projects/[id]", params: { id } });
      void setCurrentProject(id).catch(() => {});
    });
}
