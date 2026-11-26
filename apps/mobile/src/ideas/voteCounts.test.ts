import { describe, expect, it } from "vitest";

import { idea } from "./fixtures";
import { withVoteCounts } from "./voteCounts";

describe("withVoteCounts", () => {
  it("fills missing counts from the score", () => {
    const { likeCount: _l, dislikeCount: _d, ...old } = idea({ id: "a", score: 3 });
    expect(withVoteCounts(old)).toMatchObject({ likeCount: 3, dislikeCount: 0 });
    const { likeCount: _l2, dislikeCount: _d2, ...neg } = idea({ id: "b", score: -2 });
    expect(withVoteCounts(neg)).toMatchObject({ likeCount: 0, dislikeCount: 2 });
  });

  it("keeps counts that are present", () => {
    const full = idea({ id: "a", score: 1, likeCount: 4, dislikeCount: 3 });
    expect(withVoteCounts(full)).toEqual(full);
  });
});
