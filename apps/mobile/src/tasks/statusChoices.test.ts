import { describe, expect, it } from "vitest";

import { androidStatusChoices } from "./statusChoices";

describe("androidStatusChoices (R23)", () => {
  it("leaves out the current status so the Alert has room for Cancel", () => {
    expect(androidStatusChoices("todo")).toEqual(["doing", "done"]);
    expect(androidStatusChoices("doing")).toEqual(["todo", "done"]);
    expect(androidStatusChoices("done")).toEqual(["todo", "doing"]);
  });
  it("never needs more than 3 buttons with Cancel", () => {
    expect(androidStatusChoices("todo").length + 1).toBeLessThanOrEqual(3);
  });
});
