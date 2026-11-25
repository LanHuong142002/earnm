import { describe, expect, it } from "vitest";
import { buildActivityMessage, type ActivityLine } from "./activityText.js";

const line = (over: Partial<ActivityLine> = {}): ActivityLine => ({
  type: "assigned",
  actorName: "Lan",
  subjectTitle: "Đặt cọc",
  memberName: null,
  ...over,
});

describe("buildActivityMessage", () => {
  it("titles the push with the project and words each type in Vietnamese", () => {
    const m = buildActivityMessage("vi", "Nhà mới", [
      line({ type: "assigned" }),
      line({ type: "comment" }),
      line({ type: "done" }),
    ]);
    expect(m.title).toBe("Nhà mới");
    expect(m.body.split("\n")).toEqual([
      "Lan đã giao cho bạn Đặt cọc",
      "Lan đã bình luận trong Đặt cọc",
      "Lan đã hoàn thành Đặt cọc",
    ]);
  });

  it("words idea and member_joined in Vietnamese", () => {
    const m = buildActivityMessage("vi", "P", [
      line({ type: "idea", subjectTitle: "Sơn tường" }),
      line({ type: "member_joined", subjectTitle: "", actorName: null, memberName: "Minh" }),
    ]);
    expect(m.body.split("\n")).toEqual(["Lan đã thêm ý tưởng Sơn tường", "Minh đã vào dự án"]);
  });

  it("words each type in English", () => {
    const m = buildActivityMessage("en", "Home", [
      line({ type: "assigned" }),
      line({ type: "comment" }),
      line({ type: "done" }),
    ]);
    expect(m.body.split("\n")).toEqual([
      "Lan assigned you Đặt cọc",
      "Lan commented on Đặt cọc",
      "Lan finished Đặt cọc",
    ]);
    const more = buildActivityMessage("en", "Home", [
      line({ type: "idea", subjectTitle: "Paint" }),
      line({ type: "member_joined", memberName: "Minh" }),
    ]);
    expect(more.body.split("\n")).toEqual(["Lan added the idea Paint", "Minh joined the project"]);
  });

  it("shows three lines then how many more, in the language", () => {
    const five = Array.from({ length: 5 }, (_, i) => line({ subjectTitle: `T${i}` }));
    expect(buildActivityMessage("vi", "P", five).body.split("\n")).toEqual([
      "Lan đã giao cho bạn T0",
      "Lan đã giao cho bạn T1",
      "Lan đã giao cho bạn T2",
      "+2 nữa",
    ]);
    expect(buildActivityMessage("en", "P", five).body.split("\n").at(-1)).toBe("+2 more");
    expect(buildActivityMessage("en", "P", five.slice(0, 3)).body.split("\n")).toHaveLength(3);
  });

  it("falls back to Someone when the actor is missing", () => {
    expect(buildActivityMessage("vi", "P", [line({ actorName: null })]).body).toBe("Ai đó đã giao cho bạn Đặt cọc");
    expect(buildActivityMessage("en", "P", [line({ actorName: "  " })]).body).toBe("Someone assigned you Đặt cọc");
  });
});
