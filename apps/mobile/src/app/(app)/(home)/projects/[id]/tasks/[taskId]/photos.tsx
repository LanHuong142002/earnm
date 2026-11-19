import { useLocalSearchParams } from "expo-router";

import { useAuth } from "../../../../../../../auth/AuthProvider";
import { taskParent } from "../../../../../../../tasks/parent";
import { PhotoViewer } from "../../../../../../../tasks/photos/PhotoViewer";
import { useTasks } from "../../../../../../../tasks/TasksProvider";

/** The full-screen photo viewer of a task, opened at `photoId`. */
export default function PhotosScreen() {
  const { id, taskId, photoId } = useLocalSearchParams<{ id: string; taskId: string; photoId?: string }>();
  const { identity } = useAuth();
  const { tasksFor } = useTasks();
  const task = tasksFor(id).find((x) => x.id === taskId) ?? null;
  return <PhotoViewer parent={taskParent(id, taskId, task, identity?.id ?? null)} parentKnown={task !== null} photoId={photoId} />;
}
