import { describe, expect, it } from "vitest";

import { sortIngredients } from "./order";

describe("sortIngredients", () => {
  it("sorts A-Z with Vietnamese collation", () => {
    const names = ["Trà", "Đường", "Bột", "Ớt", "Ăn", "An", "Dừa"];
    const sorted = sortIngredients(names.map((name) => ({ name }))).map((i) => i.name);
    expect(sorted).toEqual(["An", "Ăn", "Bột", "Dừa", "Đường", "Ớt", "Trà"]);
  });

  it("is case-insensitive, stable and does not mutate", () => {
    const input = [
      { name: "b", id: 1 },
      { name: "B", id: 2 },
      { name: "a", id: 3 },
    ];
    const out = sortIngredients(input);
    expect(out.map((i) => i.id)).toEqual([3, 1, 2]);
    expect(input[0].id).toBe(1);
  });
});
