import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createManualScheduler, createTimerScheduler } from "./scheduler.js";

describe("createTimerScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const make = () => {
    const flush = vi.fn(async () => undefined);
    return { flush, scheduler: createTimerScheduler(flush, () => new Date()) };
  };

  it("flushes once, a little after the due time", async () => {
    const { flush, scheduler } = make();
    scheduler.schedule(new Date("2026-01-01T00:01:00Z"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(flush).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(flush).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("keeps a single timer for the earliest due time", async () => {
    const { flush, scheduler } = make();
    scheduler.schedule(new Date("2026-01-01T00:02:00Z"));
    scheduler.schedule(new Date("2026-01-01T00:01:00Z"));
    scheduler.schedule(new Date("2026-01-01T00:03:00Z"));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(flush).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it("flushes promptly for a due time already past, and again when asked again", async () => {
    const { flush, scheduler } = make();
    scheduler.schedule(new Date("2025-12-31T00:00:00Z"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flush).toHaveBeenCalledTimes(1);
    scheduler.schedule(new Date("2026-01-01T00:00:30Z"));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("logs a failed flush without throwing and can be used again", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const flush = vi.fn().mockRejectedValueOnce(new Error("db down")).mockResolvedValue(undefined);
    const scheduler = createTimerScheduler(flush, () => new Date());
    scheduler.schedule(new Date());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(error).toHaveBeenCalledTimes(1);
    scheduler.schedule(new Date());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(flush).toHaveBeenCalledTimes(2);
  });
});

describe("createManualScheduler", () => {
  it("records due times and flushes only on run", async () => {
    const flush = vi.fn(async () => undefined);
    const s = createManualScheduler(flush);
    s.schedule(new Date("2026-01-01T00:01:00Z"));
    expect(s.requested).toEqual([new Date("2026-01-01T00:01:00Z")]);
    expect(flush).not.toHaveBeenCalled();
    await s.run();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});
