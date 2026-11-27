# Spec: A comment can be saved as an idea or a drink draft (#51)

Ticket: https://github.com/LanHuong142002/earnm/issues/51
Mockup: `.ourkit/mockups/claude-ourkit-spec-15-idea-product.html`, group C (C1–C2), reviewed by the user on 2026-11-20; this change's own mockup adds the draft variant and states.
Builds on #50 (branch `claude/ourkit-50-idea-to-draft`): the New draft form already takes a prefilled source.
Tier: Feature, no Sensitive Area (mobile only; uses the existing idea and draft create calls).

## Goal

Something said in a comment can become an idea or a drink draft without retyping it: long-press the comment, pick "Thêm thành ý tưởng" or "Thêm thành nháp món", and the new form opens prefilled from the comment.

Decisions taken in Hands-off (see the Decision Log; open ones are in the Question Batch):
- Comments exist today on tasks and ideas only. Drafts get comments in #53, which will reuse this menu; nothing here is draft-comment specific.
- The "Từ bình luận của …" line shows on the form only and is not stored, so no schema or API change is needed.
- "Sao chép" from mockup C1 is left out: copying needs a new native module (`expo-clipboard`) the app doesn't have.

## Requirements

1. Long-pressing a comment in a task's or an idea's comment list opens a menu titled "Bình luận của <author name>" with "Thêm thành ý tưởng", "Thêm thành nháp món" and "Huỷ" (mockup C1). It uses the same kind of menu the comments sort already uses: an action sheet on iOS, an alert with buttons elsewhere.
2. The menu is available on every comment the person can see, their own or someone else's, including one still waiting to send or that failed to send. It is not offered on a comment that is being edited.
3. The comment offers the same two choices as accessibility actions, so they can be reached without a long-press gesture.
4. "Thêm thành ý tưởng" opens the New idea form of the same project prefilled (mockup C2): title = the comment's first sentence, cut to 120 characters at a word boundary where possible; description = the whole comment (comments are at most 1000 characters, descriptions 2000, so no cut). Both stay editable. Labels start empty.
5. "Thêm thành nháp món" opens the New draft form of the same project prefilled: name = the first sentence, cut to 60 characters at a word boundary where possible; note = the whole comment, cut to 500 characters (the draft form's note limit). Sizes and price start as on the normal New draft form.
6. The first sentence is the text up to and including the first ".", "!", "?" or "…" that is followed by a space, a line break or the end, or up to the first line break, whichever comes first, trimmed. If that is empty, the whole comment is used.
7. Both forms show the line "Từ bình luận của <author name> ở “<task or idea title>”" above the fields. If the author's name isn't known, it reads "Từ một bình luận ở “<title>”".
8. Saving goes through the normal create of that form, so it works offline and queues exactly like a normal new idea or new draft. After saving, the app opens what the normal form opens. Cancel or back returns to the screen with the comment.
9. Nothing about the comment changes: it is not edited, moved or linked.

## Acceptance Criteria

1. R1: long-press a comment on a task: the menu shows its title and the three items. Same on an idea's comment.
2. R2: the menu appears on your own comment, on another member's comment, and on a waiting comment; it does not appear while that comment is in edit mode.
3. R3: with a screen reader, the comment offers "Thêm thành ý tưởng" and "Thêm thành nháp món" as actions.
4. R4: from the comment "Hay mình làm thêm cà phê muối đi, quán bên kia bán chạy lắm. Kem muối…", the New idea form shows title "Hay mình làm thêm cà phê muối đi, quán bên kia bán chạy lắm." and the whole comment as description.
5. R5: from the same comment, the New draft form shows a name of at most 60 characters ending at a word boundary, and the comment (cut to 500) as note.
6. R6: unit tests for the first-sentence rule: ".", "!", "?", "…", line break, no punctuation, a dot inside a number ("3.5k" is not an end), only whitespace, and emoji counted as one character when cutting.
7. R7: the line names the author and the task or idea; an unknown author gives the fallback text.
8. R8: with the phone offline, saving the prefilled idea and the prefilled draft each shows them as waiting, and they reach the server after reconnecting. Cancel returns to the comment's screen.
9. R9: after saving, the source comment's text and position are unchanged.
10. Existing tests pass; `ourkit gate run test`, lint and build pass.

## Out of Scope

- Sharing from other apps (Zalo and others).
- Storing or showing on the new idea or draft where it came from.
- Comments on drafts (#53).
- "Sao chép" (copy to clipboard).
- Creating a task from a comment.

## Open Questions

- Add "Sao chép" with the `expo-clipboard` module now, or leave it out (assumed)?
- Keep "Từ bình luận của …" on the form only (assumed), or store it and show it on the new idea or draft?
