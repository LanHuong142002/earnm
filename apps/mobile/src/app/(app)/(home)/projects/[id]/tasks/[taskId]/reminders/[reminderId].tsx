import { useLocalSearchParams } from "expo-router";

import { ReminderForm } from "../../../../../../../../tasks/reminders/ReminderForm";

/** "Sửa lời nhắc": pushed from a reminder row; back returns without saving. */
export default function EditReminderScreen() {
  const { id, taskId, reminderId } = useLocalSearchParams<{ id: string; taskId: string; reminderId: string }>();
  return <ReminderForm projectId={id} taskId={taskId} reminderId={reminderId} />;
}
