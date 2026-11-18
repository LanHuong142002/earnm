import { useLocalSearchParams } from "expo-router";

import { ReminderForm } from "../../../../../../../../tasks/reminders/ReminderForm";

/** "Lời nhắc mới": pushed from the task screen; back returns without saving. */
export default function NewReminderScreen() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  return <ReminderForm projectId={id} taskId={taskId} />;
}
