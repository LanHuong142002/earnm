import { describe, expect, it } from "vitest";

import { createMemoryStore } from "../sync/storage";
import { clearProfile, readProfile, visibleProfile, writeProfile } from "./profile-store";

const ME = { userId: "u1", email: "a@b.vn", displayName: "An" };

describe("profile store", () => {
  it("round-trips for the same user", async () => {
    const store = createMemoryStore();
    await writeProfile(store, ME);
    expect(await readProfile(store, "u1")).toEqual({ email: "a@b.vn", displayName: "An" });
  });

  it("returns null for a different user id", async () => {
    const store = createMemoryStore();
    await writeProfile(store, ME);
    expect(await readProfile(store, "u2")).toBeNull();
  });

  it("returns null when nothing is stored", async () => {
    expect(await readProfile(createMemoryStore(), "u1")).toBeNull();
  });

  it("returns null for malformed data", async () => {
    for (const bad of ["x", 5, [], { userId: "u1" }, { userId: "u1", email: 1, displayName: "A" }]) {
      const store = createMemoryStore();
      await store.setJSON("profile.v1", bad);
      expect(await readProfile(store, "u1")).toBeNull();
    }
  });

  it("clears", async () => {
    const store = createMemoryStore();
    await writeProfile(store, ME);
    await clearProfile(store);
    expect(await readProfile(store, "u1")).toBeNull();
  });
});

describe("visibleProfile", () => {
  const user = { id: "u2", email: "c@d.vn", displayName: "Bình", language: null };
  it("prefers the known user over any stored profile", () => {
    expect(visibleProfile(user, { email: "a@b.vn", displayName: "An" })).toEqual({
      email: "c@d.vn",
      displayName: "Bình",
    });
  });
  it("falls back to the stored profile when the user is unknown", () => {
    expect(visibleProfile(null, { email: "a@b.vn", displayName: "An" })).toEqual({
      email: "a@b.vn",
      displayName: "An",
    });
  });
  it("is null when neither is known", () => {
    expect(visibleProfile(null, null)).toBeNull();
  });
});
