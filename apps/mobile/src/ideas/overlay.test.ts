import { describe, expect, it } from "vitest";

import type { Change } from "../sync/queue";
import { idea } from "./fixtures";
import { applyIdeaOverlay, pendingIdeaIds, toggleVote, withVote } from "./overlay";
import { ideaCreateChange, ideaDeleteChange, ideaLabelsChange, ideaUpdateChange, ideaVoteChange } from "./sync";

const NOW = new Date("2026-11-18T09:00:00.000Z");
let n = 0;
/** What the queue would hold: the change with an id, a creation time and a time for each field. */
function waitingOf(change: ReturnType<typeof ideaVoteChange>): Change {
  n += 1;
  return { ...change, changeId: `c${n}`, createdAt: NOW.toISOString(), fieldTimes: change.fieldTimes ?? {} };
}

describe("votes", () => {
  it("withVote moves the score by the difference", () => {
    const base = idea({ id: "i1", score: 3, myVote: 0 });
    expect(withVote(base, 1)).toMatchObject({ score: 4, myVote: 1 });
    expect(withVote(withVote(base, 1), -1)).toMatchObject({ score: 2, myVote: -1 });
    expect(withVote(withVote(base, 1), 0)).toMatchObject({ score: 3, myVote: 0 });
  });

  it("toggleVote takes your own vote back", () => {
    expect(toggleVote(0, 1)).toBe(1);
    expect(toggleVote(1, 1)).toBe(0);
    expect(toggleVote(-1, 1)).toBe(1);
    expect(toggleVote(0, -1)).toBe(-1);
    expect(toggleVote(-1, -1)).toBe(0);
  });
});

describe("applyIdeaOverlay (spec AC22)", () => {
  it("a waiting vote adjusts the score and your vote at once", () => {
    const server = [idea({ id: "i1", score: 4, myVote: 0 }), idea({ id: "i2", score: 4 })];
    const waiting = [waitingOf(ideaVoteChange({ id: "i1", projectId: "p1", value: 1, now: NOW }))];
    const shown = applyIdeaOverlay("p1", server, waiting);
    expect(shown[0]).toMatchObject({ score: 5, myVote: 1 });
    expect(shown[1]).toMatchObject({ score: 4, myVote: 0 });
  });

  it("changing a vote already cast moves the score from the server's own vote", () => {
    const server = [idea({ id: "i1", score: 4, myVote: 1 })];
    const down = [waitingOf(ideaVoteChange({ id: "i1", projectId: "p1", value: -1, now: NOW }))];
    expect(applyIdeaOverlay("p1", server, down)[0]).toMatchObject({ score: 2, myVote: -1 });
    const none = [waitingOf(ideaVoteChange({ id: "i1", projectId: "p1", value: 0, now: NOW }))];
    expect(applyIdeaOverlay("p1", server, none)[0]).toMatchObject({ score: 3, myVote: 0 });
  });

  it("does not change the list it is given", () => {
    const server = [idea({ id: "i1", score: 4 })];
    applyIdeaOverlay("p1", server, [waitingOf(ideaVoteChange({ id: "i1", projectId: "p1", value: 1, now: NOW }))]);
    expect(server[0]).toMatchObject({ score: 4, myVote: 0 });
  });

  it("shows a waiting create as an idea made by me, and a vote on it", () => {
    const create = waitingOf(
      ideaCreateChange({ id: "i9", projectId: "p1", title: "Mới", description: "Mô tả", author: { id: "u1", displayName: "An" }, now: NOW }),
    );
    const vote = waitingOf(ideaVoteChange({ id: "i9", projectId: "p1", value: 1, now: NOW }));
    const shown = applyIdeaOverlay("p1", [], [create, vote]);
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      id: "i9",
      title: "Mới",
      description: "Mô tả",
      status: "new",
      author: { id: "u1", displayName: "An" },
      score: 1,
      myVote: 1,
      labelIds: [],
    });
  });

  it("applies every field of a waiting edit: title, description and status", () => {
    const server = [idea({ id: "i1", title: "Cũ", description: "Cũ", status: "new" })];
    const edit = waitingOf(
      ideaUpdateChange({ id: "i1", projectId: "p1", fields: { title: "Mới", description: "Mô tả mới", status: "accepted" }, now: NOW }),
    );
    expect(applyIdeaOverlay("p1", server, [edit])[0]).toMatchObject({ title: "Mới", description: "Mô tả mới", status: "accepted" });
  });

  it("a status chosen while the create waits shows on the new idea", () => {
    const create = waitingOf(ideaCreateChange({ id: "i9", projectId: "p1", title: "Mới", description: "", author: null, now: NOW }));
    const folded: Change = { ...create, data: { ...create.data, status: "considering" } };
    expect(applyIdeaOverlay("p1", [], [folded])[0]).toMatchObject({ status: "considering", author: null });
  });

  it("a waiting label set replaces the labels", () => {
    const server = [idea({ id: "i1", labelIds: ["a", "b"] })];
    const labels = waitingOf(ideaLabelsChange({ id: "i1", projectId: "p1", labelIds: ["c"], now: NOW }));
    expect(applyIdeaOverlay("p1", server, [labels])[0].labelIds).toEqual(["c"]);
  });

  it("a waiting delete hides the idea", () => {
    const server = [idea({ id: "i1" }), idea({ id: "i2" })];
    const del = waitingOf(ideaDeleteChange({ id: "i1", projectId: "p1" }));
    expect(applyIdeaOverlay("p1", server, [del]).map((i) => i.id)).toEqual(["i2"]);
  });

  it("ignores changes of other projects and of ideas that are not there", () => {
    const server = [idea({ id: "i1" })];
    const other = waitingOf(ideaVoteChange({ id: "i1", projectId: "p2", value: 1, now: NOW }));
    const missing = waitingOf(ideaVoteChange({ id: "zz", projectId: "p1", value: 1, now: NOW }));
    const edit = waitingOf(ideaUpdateChange({ id: "zz", projectId: "p1", fields: { title: "x" }, now: NOW }));
    expect(applyIdeaOverlay("p1", server, [other, missing, edit])).toEqual(server);
  });
});

describe("pendingIdeaIds", () => {
  it("lists the ideas with a waiting change of this project", () => {
    const waiting = [
      waitingOf(ideaVoteChange({ id: "i1", projectId: "p1", value: 1, now: NOW })),
      waitingOf(ideaUpdateChange({ id: "i2", projectId: "p1", fields: { title: "x" }, now: NOW })),
      waitingOf(ideaLabelsChange({ id: "i3", projectId: "p1", labelIds: [], now: NOW })),
      waitingOf(ideaVoteChange({ id: "i4", projectId: "p2", value: 1, now: NOW })),
    ];
    expect([...pendingIdeaIds("p1", waiting)].sort()).toEqual(["i1", "i2", "i3"]);
  });
});
