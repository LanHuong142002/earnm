import { describe, expect, it } from "vitest";

import { isReconnect } from "./reconnect";

const up = { isConnected: true, isInternetReachable: true };
const upUnknown = { isConnected: true, isInternetReachable: null };
const down = { isConnected: false, isInternetReachable: false };
const unreachable = { isConnected: true, isInternetReachable: false };

describe("isReconnect", () => {
  it("ignores the first event", () => {
    expect(isReconnect(null, up)).toBe(false);
    expect(isReconnect(null, down)).toBe(false);
  });
  it("is true for offline to online", () => {
    expect(isReconnect(down, up)).toBe(true);
    expect(isReconnect(unreachable, up)).toBe(true);
    expect(isReconnect(down, upUnknown)).toBe(true);
  });
  it("is false when nothing came back", () => {
    expect(isReconnect(up, up)).toBe(false);
    expect(isReconnect(up, down)).toBe(false);
    expect(isReconnect(down, unreachable)).toBe(false);
  });
});
