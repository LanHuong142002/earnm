import { describe, expect, it } from "vitest";

import {
  commentSourceParams,
  draftFromComment,
  firstSentence,
  ideaFromComment,
  readCommentSource,
  sourceLine,
  type CommentSource,
} from "./commentSource";

const source = (text: string, over: Partial<CommentSource> = {}): CommentSource => ({ text, authorName: "Minh", sourceTitle: "Chuẩn bị khai trương", ...over });

describe("firstSentence", () => {
  it("ends at a full stop followed by a space", () => {
    expect(firstSentence("Làm thêm cà phê muối đi. Kem muối thì đánh sau.")).toBe("Làm thêm cà phê muối đi.");
  });

  it("ends at ! ? and … followed by a space", () => {
    expect(firstSentence("Hay quá! Làm đi")).toBe("Hay quá!");
    expect(firstSentence("Làm không? Chắc là có")).toBe("Làm không?");
    expect(firstSentence("Để xem… rồi tính")).toBe("Để xem…");
  });

  it("ends at the end mark at the end of the text", () => {
    expect(firstSentence("Chỉ một câu.")).toBe("Chỉ một câu.");
  });

  it("ends at a line break", () => {
    expect(firstSentence("Dòng một không dấu\nDòng hai. Còn nữa")).toBe("Dòng một không dấu");
    expect(firstSentence("Dòng một.\r\nDòng hai")).toBe("Dòng một.");
  });

  it("takes the line break when it comes before the end mark", () => {
    expect(firstSentence("Một dòng\nHai. Ba")).toBe("Một dòng");
  });

  it("returns the whole text when there is no ending", () => {
    expect(firstSentence("Thử thêm siro đào")).toBe("Thử thêm siro đào");
  });

  it("does not end at a dot inside a number", () => {
    expect(firstSentence("Giá 3.5k một ly. Hơi đắt")).toBe("Giá 3.5k một ly.");
    expect(firstSentence("Giá 3.5k một ly")).toBe("Giá 3.5k một ly");
  });

  it("does not end at a mark that is followed by another character", () => {
    expect(firstSentence("Xem a.b rồi nói")).toBe("Xem a.b rồi nói");
  });

  it("keeps repeated marks together", () => {
    expect(firstSentence("Thật à?! Ừ")).toBe("Thật à?!");
  });

  it("trims the text and the sentence", () => {
    expect(firstSentence("  \n Xin chào.   Tạm biệt ")).toBe("Xin chào.");
  });

  it("gives an empty string for whitespace only", () => {
    expect(firstSentence("  \n \t ")).toBe("");
  });
});

describe("ideaFromComment", () => {
  const text = "Hay mình làm thêm cà phê muối đi, quán bên kia bán chạy lắm. Kem muối thì đánh từ whipping với chút muối.";

  it("takes the first sentence as the title and the whole comment as the description", () => {
    expect(ideaFromComment(source(text))).toEqual({
      title: "Hay mình làm thêm cà phê muối đi, quán bên kia bán chạy lắm.",
      description: text,
    });
  });

  it("cuts a long title to 120 at a word boundary", () => {
    const long = `${"abcd ".repeat(40)}end`;
    const { title } = ideaFromComment(source(long));
    expect([...title].length).toBeLessThanOrEqual(120);
    expect(long.startsWith(title)).toBe(true);
    expect(long[title.length]).toBe(" ");
  });

  it("keeps the title within 120 UTF-16 code units, as the server counts, without splitting an emoji", () => {
    const { title } = ideaFromComment(source("😀".repeat(130)));
    expect(title.length).toBe(120);
    expect(title).toBe("😀".repeat(60));
    expect(ideaFromComment(source(`a${"😀".repeat(130)}`)).title).toBe(`a${"😀".repeat(59)}`);
  });
});

describe("draftFromComment", () => {
  const text = "Hay mình làm thêm cà phê muối đi, quán bên kia bán chạy lắm. Kem muối thì đánh từ whipping với chút muối.";

  it("cuts the name to 60 at a word boundary", () => {
    const { name } = draftFromComment(source(text));
    expect([...name].length).toBeLessThanOrEqual(60);
    expect(name).toBe("Hay mình làm thêm cà phê muối đi, quán bên kia bán chạy lắm.");
  });

  it("cuts a longer first sentence at a word boundary", () => {
    const long = "Hay mình làm thêm cà phê muối đi vì quán bên kia bán chạy lắm và khách rất thích";
    const { name } = draftFromComment(source(long));
    expect([...name].length).toBeLessThanOrEqual(60);
    expect(long.startsWith(name)).toBe(true);
    expect(long[name.length]).toBe(" ");
  });

  it("keeps the whole comment as the note up to 500 characters", () => {
    expect(draftFromComment(source(text)).note).toBe(text);
    const note = draftFromComment(source("😀".repeat(600))).note;
    expect(note.length).toBe(500);
    expect(note).toBe("😀".repeat(250));
  });

  it("keeps the name and note within the form's code-unit limits without splitting an emoji", () => {
    expect(draftFromComment(source("😀".repeat(70))).name).toBe("😀".repeat(30));
    const odd = draftFromComment(source(`a${"😀".repeat(400)}`)).note;
    expect(odd).toBe(`a${"😀".repeat(249)}`);
    expect(odd.length).toBeLessThanOrEqual(500);
  });
});

describe("sourceLine", () => {
  it("names the author and the title", () => {
    expect(sourceLine(source("x"))).toEqual({ key: "tasks.comments.sourceLine", values: { name: "Minh", title: "Chuẩn bị khai trương" } });
  });

  it("falls back when the author is unknown", () => {
    expect(sourceLine(source("x", { authorName: "" }))).toEqual({ key: "tasks.comments.sourceLineUnknown", values: { title: "Chuẩn bị khai trương" } });
    expect(sourceLine(source("x", { authorName: "  " })).key).toBe("tasks.comments.sourceLineUnknown");
  });
});

describe("commentSourceParams and readCommentSource", () => {
  it("round-trips a source", () => {
    const s = source("Hay quá! Làm đi");
    expect(readCommentSource(commentSourceParams(s))).toEqual(s);
  });

  it("makes string params with fromComment 1", () => {
    const p = commentSourceParams(source("x"));
    expect(p.fromComment).toBe("1");
    expect(Object.values(p).every((v) => typeof v === "string")).toBe(true);
  });

  it("ignores missing or malformed params", () => {
    expect(readCommentSource({})).toBeNull();
    expect(readCommentSource({ commentText: "x" })).toBeNull();
    expect(readCommentSource({ fromComment: "0", commentText: "x" })).toBeNull();
    expect(readCommentSource({ fromComment: "1" })).toBeNull();
    expect(readCommentSource({ fromComment: "1", commentText: "   " })).toBeNull();
    expect(readCommentSource({ fromComment: ["1"], commentText: "x" })).toBeNull();
    expect(readCommentSource({ fromComment: "1", commentText: ["a", "b"] })).toBeNull();
  });

  it("treats a malformed author or title as empty", () => {
    expect(readCommentSource({ fromComment: "1", commentText: "x", commentAuthor: ["a"], commentTitle: 5 as unknown as string })).toEqual({
      text: "x",
      authorName: "",
      sourceTitle: "",
    });
  });

  it("caps the text at 1000 code units and the names at 120", () => {
    const s = readCommentSource({ fromComment: "1", commentText: "😀".repeat(1500), commentAuthor: "a".repeat(300), commentTitle: "b".repeat(300) })!;
    expect(s.text).toBe("😀".repeat(500));
    expect(s.authorName).toHaveLength(120);
    expect(s.sourceTitle).toHaveLength(120);
  });
});
