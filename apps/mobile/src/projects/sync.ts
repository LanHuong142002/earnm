import type { Change, Queue } from "../sync/queue";
import {
  createProject,
  deleteProject,
  patchProject,
  type CreateProjectBody,
  type ProjectField,
  type ProjectFieldPatch,
} from "./api";

export const PROJECT_ENTITY = "project";

const FIELDS: ProjectField[] = ["name", "description", "currency"];

type Deps = {
  createProject: (token: string, body: CreateProjectBody) => Promise<unknown>;
  patchProject: (token: string, id: string, fields: ProjectFieldPatch) => Promise<unknown>;
  deleteProject: (token: string, id: string) => Promise<unknown>;
};

const realDeps: Deps = { createProject, patchProject, deleteProject };

function latestTime(change: Change): string {
  let latest = change.createdAt;
  for (const t of Object.values(change.fieldTimes)) {
    if (Date.parse(t) > Date.parse(latest)) latest = t;
  }
  return latest;
}

export function registerProjectEntity(queue: Queue, deps: Deps = realDeps): void {
  queue.registerEntity(PROJECT_ENTITY, {
    create: (change, token) =>
      deps.createProject(token, {
        id: change.entityId,
        name: change.data.name as string,
        currency: change.data.currency as CreateProjectBody["currency"],
        description: change.data.description as string | undefined,
        editedAt: Object.keys(change.fieldTimes).length > 0 ? latestTime(change) : change.createdAt,
      }),
    update: (change, token) => {
      const fields: ProjectFieldPatch = {};
      for (const field of FIELDS) {
        if (field in change.data) {
          fields[field] = { value: change.data[field], editedAt: change.fieldTimes[field] ?? change.createdAt };
        }
      }
      return deps.patchProject(token, change.entityId, fields);
    },
    delete: (change, token) => deps.deleteProject(token, change.entityId),
  });
}
