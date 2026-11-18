import { useLocalSearchParams } from "expo-router";

import { PhotoViewer } from "../../../../../../../tasks/photos/PhotoViewer";

/** The full-screen photo viewer of a task, opened at `photoId`. */
export default function PhotosScreen() {
  const { id, taskId, photoId } = useLocalSearchParams<{ id: string; taskId: string; photoId?: string }>();
  return <PhotoViewer projectId={id} taskId={taskId} photoId={photoId} />;
}
