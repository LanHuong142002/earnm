import { describe, expect, it, vi } from "vitest";

import type { Change, ChangeKind, Queue, Sender } from "../sync/queue";
import { PROJECT_ENTITY, registerProjectEntity } from "./sync";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-01T00:00:01.000Z";
const T2 = "2026-01-01T00:00:02.000Z";

function setup() {
  let senders!: Record<ChangeKind, Sender>;
  let entity = "";
  const queue = {
    registerEntity: (e: string, s: Record<ChangeKind, Sender>) => {
      entity = e;
      senders = s;
    },
  } as unknown as Queue;
  const deps = {
    createProject: vi.fn(async () => ({})),
    patchProject: vi.fn(async () => ({})),
    deleteProject: vi.fn(async () => undefined),
  };
  registerProjectEntity(queue, deps as never);
  return { senders, entity, deps };
}

const base: Change = {
  changeId: "c",
  entity: "project",
  entityId: "p1",
  kind: "create",
  data: {},
  fieldTimes: {},
  createdAt: T0,
};

describe("registerProjectEntity", () => {
  it("registers under the project entity", () => {
    expect(setup().entity).toBe(PROJECT_ENTITY);
    expect(PROJECT_ENTITY).toBe("project");
  });

  it("create posts all fields with the latest field time", async () => {
    const { senders, deps } = setup();
    await senders.create(
      {
        ...base,
        data: { name: "N", currency: "USD", description: "d" },
        fieldTimes: { name: T1, currency: T2, description: T1 },
      },
      "tok",
    );
    expect(deps.createProject).toHaveBeenCalledWith("tok", {
      id: "p1",
      name: "N",
      currency: "USD",
      description: "d",
      editedAt: T2,
    });
  });

  it("create falls back to createdAt when there are no field times", async () => {
    const { senders, deps } = setup();
    await senders.create({ ...base, data: { name: "N", currency: "VND" } }, "tok");
    expect(deps.createProject).toHaveBeenCalledWith("tok", {
      id: "p1",
      name: "N",
      currency: "VND",
      description: undefined,
      editedAt: T0,
    });
  });

  it("update sends only changed fields, each with its own editedAt", async () => {
    const { senders, deps } = setup();
    await senders.update(
      { ...base, kind: "update", data: { name: "X", currency: "USD" }, fieldTimes: { name: T1, currency: T2 } },
      "tok",
    );
    expect(deps.patchProject).toHaveBeenCalledWith("tok", "p1", {
      name: { value: "X", editedAt: T1 },
      currency: { value: "USD", editedAt: T2 },
    });
  });

  it("delete calls deleteProject", async () => {
    const { senders, deps } = setup();
    await senders.delete({ ...base, kind: "delete" }, "tok");
    expect(deps.deleteProject).toHaveBeenCalledWith("tok", "p1");
  });
});
