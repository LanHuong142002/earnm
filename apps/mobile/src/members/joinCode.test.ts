import { describe, expect, it } from "vitest";

import { joinCodeState } from "./joinCode";

describe("joinCodeState", () => {
  it.each([
    ["k7qm-r4xp", "K7QMR4XP"],
    [" K7QM R4XP ", "K7QMR4XP"],
    ["K7QMR4XP", "K7QMR4XP"],
    ["k7-qm r4-xp", "K7QMR4XP"],
  ])("accepts %j", (input, normalized) => {
    expect(joinCodeState(input)).toEqual({ normalized, canSubmit: true });
  });

  it.each([
    ["7 characters", "K7QMR4X"],
    ["9 characters", "K7QMR4XPA"],
    ["empty", ""],
    ["only separators", " - - "],
    ["letter O", "K7QMR4XO"],
    ["digit 0", "K7QMR4X0"],
    ["letter I", "K7QMR4XI"],
    ["digit 1", "K7QMR4X1"],
    ["letter L", "K7QMR4XL"],
  ])("rejects %s", (_name, input) => {
    expect(joinCodeState(input)).toEqual({ normalized: null, canSubmit: false });
  });
});
