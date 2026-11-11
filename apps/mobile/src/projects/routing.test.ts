import { describe, expect, it } from "vitest";

import type { Project } from "./api";
import { homeCard, projectView, showInvitation, showOfflineEmpty } from "./routing";

const owner: Project = { id: "a", name: "A", description: "", currency: "VND", role: "owner" };
const member: Project = { ...owner, role: "member" };

describe("homeCard", () => {
  it("shows the current project", () => {
    expect(homeCard(owner, "ready", 1)).toBe("project");
  });
  it("invites creating a project when there is none", () => {
    expect(homeCard(null, "ready", 0)).toBe("invite");
  });
  it("shows a neutral offline card, not an invitation, when offline with nothing cached", () => {
    expect(homeCard(null, "offline", 0)).toBe("offline");
  });
  it("waits only while the first refresh runs with nothing cached", () => {
    expect(homeCard(null, "loading", 0)).toBe("loading");
    expect(homeCard(null, "loading", 2)).toBe("choose");
  });
  it("invites choosing a project when some exist but none is current", () => {
    expect(homeCard(null, "ready", 2)).toBe("choose");
    expect(homeCard(null, "offline", 1)).toBe("choose");
  });
});

describe("Project list empty states", () => {
  it("invites only after a successful refresh", () => {
    expect(showInvitation("ready", 0)).toBe(true);
    expect(showInvitation("offline", 0)).toBe(false);
    expect(showInvitation("loading", 0)).toBe(false);
    expect(showInvitation("ready", 1)).toBe(false);
  });
  it("shows the offline state when offline with nothing cached", () => {
    expect(showOfflineEmpty("offline", 0)).toBe(true);
    expect(showOfflineEmpty("offline", 2)).toBe(false);
    expect(showOfflineEmpty("ready", 0)).toBe(false);
  });
});

describe("projectView", () => {
  it("shows a known project", () => {
    expect(projectView(owner, "ready", false)).toBe("ready");
    expect(projectView(member, "ready", false)).toBe("ready");
  });
  it("waits while loading, leaves once settled without the project", () => {
    expect(projectView(null, "loading", false)).toBe("loading");
    expect(projectView(null, "ready", false)).toBe("leave");
    expect(projectView(null, "offline", true)).toBe("leave");
  });
  it("leaves Edit for a Member", () => {
    expect(projectView(member, "ready", true)).toBe("leave");
    expect(projectView(owner, "ready", true)).toBe("ready");
  });
});
