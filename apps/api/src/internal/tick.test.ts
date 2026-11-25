import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import * as activity from "../push/activity.js";
import * as catchUp from "../push/catchUp.js";
import { createFakeSender } from "../push/sender.js";
import { createClock, createSignedInUser, prisma, useTestApp } from "../test/helpers.js";

vi.mock("../push/activity.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../push/activity.js")>()),
  flushActivity: vi.fn(),
}));
vi.mock("../push/catchUp.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../push/catchUp.js")>()),
  runCatchUp: vi.fn(),
}));

const SECRET = "test-only-fake-internal-secret-0123456789abcdef";
const T0 = new Date("2026-01-01T00:00:00Z");

// Ticket #16: the tick's three jobs (reminders, activity pushes, 30-day cleanup) fail independently.
describe("POST /internal/tick isolation", () => {
  useTestApp();
  const clock = createClock();
  const flush = vi.mocked(activity.flushActivity);
  const catchUpMock = vi.mocked(catchUp.runCatchUp);
  const app = () =>
    createApp({ prisma, now: () => T0, internalSecret: SECRET, pushSender: createFakeSender() });
  const tick = () => request(app()).post("/internal/tick").set("Authorization", `Bearer ${SECRET}`);

  async function oldEvent() {
    const u = await createSignedInUser(clock);
    const t = clock.now();
    const p = await prisma.project.create({
      data: { id: randomUUID(), name: "Bếp", currency: "VND", nameEditedAt: t, descriptionEditedAt: t, currencyEditedAt: t },
    });
    const occurredAt = new Date(T0.getTime() - 31 * 86_400_000);
    await prisma.activityEvent.create({
      data: { projectId: p.id, type: "member_joined", actorId: u.id, subjectTitle: "x", occurredAt },
    });
  }

  beforeEach(() => {
    flush.mockReset();
    catchUpMock.mockReset();
    catchUpMock.mockResolvedValue({ sent: 0 });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("a failing activity flush still runs the reminders and the cleanup", async () => {
    flush.mockRejectedValue(new Error("boom"));
    await oldEvent();
    const res = await tick();
    expect(catchUpMock).toHaveBeenCalledTimes(1);
    expect(await prisma.activityEvent.count()).toBe(0);
    expect(res.status).toBe(500);
  });

  it("a failing reminder run still flushes activity and cleans up, and still reports the failure", async () => {
    catchUpMock.mockRejectedValue(new Error("boom"));
    flush.mockResolvedValue({ sent: 0, dropped: 0, muted: 0 });
    await oldEvent();
    const res = await tick();
    expect(flush).toHaveBeenCalledTimes(1);
    expect(await prisma.activityEvent.count()).toBe(0);
    expect(res.status).toBe(500);
  });

  it("answers ok when nothing fails", async () => {
    flush.mockResolvedValue({ sent: 0, dropped: 0, muted: 0 });
    const res = await tick();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});
