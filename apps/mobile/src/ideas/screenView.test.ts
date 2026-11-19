import { describe, expect, it } from "vitest";

import { idea } from "./fixtures";
import { canEditAs, ideaDayOf, ideaStatusTone, ideaView, isOnline, voteChoice, votePressedState } from "./screenView";

describe("ideaView", () => {
  const base = { projectFound: true, projectsStatus: "ready" as const, ideasReady: true, ideaFound: true };
  it("shows the idea when everything is known", () => expect(ideaView(base)).toBe("ready"));
  it("waits while the projects load", () => {
    expect(ideaView({ ...base, projectFound: false, projectsStatus: "loading" })).toBe("loading");
  });
  it("leaves when the project is gone", () => {
    expect(ideaView({ ...base, projectFound: false })).toBe("leave");
    expect(ideaView({ ...base, projectFound: false, projectsStatus: "offline" })).toBe("leave");
  });
  it("waits for the local copy before judging the idea", () => {
    expect(ideaView({ ...base, ideasReady: false, ideaFound: false })).toBe("loading");
  });
  it("leaves when the idea is gone", () => expect(ideaView({ ...base, ideaFound: false })).toBe("leave"));
});

describe("isOnline", () => {
  it("is false when the projects or the profile could not be reached", () => {
    expect(isOnline("ready", "ready")).toBe(true);
    expect(isOnline("loading", "loading")).toBe(true);
    expect(isOnline("offline", "ready")).toBe(false);
    expect(isOnline("ready", "offline")).toBe(false);
  });
});

describe("canEditAs", () => {
  const mine = idea({ id: "i", author: { id: "me", displayName: "Me" } });
  it("lets the author and an Owner edit", () => {
    expect(canEditAs(mine, { id: "me" }, "member")).toBe(true);
    expect(canEditAs(mine, { id: "other" }, "owner")).toBe(true);
  });
  it("keeps others out", () => expect(canEditAs(mine, { id: "other" }, "member")).toBe(false));
  it("refuses when the person or role is unknown", () => {
    expect(canEditAs(mine, null, "owner")).toBe(false);
    expect(canEditAs(mine, { id: "me" }, null)).toBe(false);
  });
});

describe("votes", () => {
  it("marks only the chosen direction", () => {
    expect(votePressedState(1)).toEqual({ up: true, down: false });
    expect(votePressedState(-1)).toEqual({ up: false, down: true });
    expect(votePressedState(0)).toEqual({ up: false, down: false });
  });
  it("names the vote for the screen reader", () => {
    expect(voteChoice(1)).toBe("up");
    expect(voteChoice(-1)).toBe("down");
    expect(voteChoice(0)).toBe("none");
  });
});

describe("ideaStatusTone", () => {
  it("gives each status its own look", () => {
    expect(ideaStatusTone("new")).toBe("accent");
    expect(ideaStatusTone("considering")).toBe("blue");
    expect(ideaStatusTone("accepted")).toBe("green");
    expect(ideaStatusTone("dropped")).toBe("muted");
  });
});

describe("ideaDayOf", () => {
  it("reads the local day of a time", () => {
    const at = new Date(2026, 10, 12, 9, 30);
    expect(ideaDayOf(at.toISOString())).toBe("2026-11-12");
  });
  it("is null for something that is not a time", () => expect(ideaDayOf("nope")).toBeNull());
});
