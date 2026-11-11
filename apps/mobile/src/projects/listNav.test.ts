import { describe, expect, it } from "vitest";

import { createTapGuard, stepsToList } from "./listNav";

const L = "projects/index";
const P = "projects/[id]/index";
const E = "projects/[id]/edit";

describe("stepsToList", () => {
  it("pops back to the list when it is in the stack (delete from Home > List > Project > Edit)", () => {
    expect(stepsToList(["index", L, P, E])).toEqual([{ type: "POP", payload: { count: 2 } }]);
    expect(stepsToList(["index", L, P])).toEqual([{ type: "POP", payload: { count: 1 } }]);
  });
  it("does nothing when the list is already on top", () => {
    expect(stepsToList(["index", L])).toEqual([]);
  });
  it("resets to [Home, List] when the list is not in the stack (Home > Project > Edit)", () => {
    expect(stepsToList(["index", P, E])).toEqual([
      { type: "POP_TO_TOP" },
      { type: "PUSH", payload: { name: L } },
    ]);
  });
  it("puts Home first when the stack started on another screen (deep link)", () => {
    expect(stepsToList([P])).toEqual([
      { type: "POP_TO_TOP" },
      { type: "REPLACE", payload: { name: "index" } },
      { type: "PUSH", payload: { name: L } },
    ]);
  });
  it("uses the topmost list when there are several", () => {
    expect(stepsToList(["index", L, P, L, P])).toEqual([{ type: "POP", payload: { count: 1 } }]);
  });
});

describe("createTapGuard", () => {
  it("lets a second tap inside the window through only after it", () => {
    let t = 1000;
    const g = createTapGuard(600, () => t);
    expect(g.allow()).toBe(true);
    t += 100;
    expect(g.allow()).toBe(false);
    t += 600;
    expect(g.allow()).toBe(true);
  });
});
