import { useAuth } from "../../auth/AuthProvider";
import { useMembers } from "../../members/useMembers";
import { buildAssigneeOptions, type AssigneeOption } from "../assignees";
import { deriveMembers } from "../localChange";
import { useTasks } from "../TasksProvider";

/**
 * The people a reminder can go to: the project's current members, with the saved identity standing in for me while the
 * profile request is pending (so the list is never empty), and every id's name for the rows.
 */
export function usePeople(projectId: string, selectedIds: string[]): { options: AssigneeOption[]; names: Record<string, string>; meId: string | null } {
  const { identity } = useAuth();
  const { tasksFor } = useTasks();
  const { members } = useMembers(projectId);
  const me = identity ? { id: identity.id, displayName: identity.displayName } : null;
  const known = deriveMembers(me, tasksFor(projectId), []);
  const options = buildAssigneeOptions({ members, known, selectedIds, me });
  const names: Record<string, string> = {};
  for (const person of [...known, ...options]) names[person.id] = person.displayName;
  return { options, names, meId: me?.id ?? null };
}
