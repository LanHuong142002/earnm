# Change Report: A comment can be saved as an idea or a drink draft (#51)

## Summary

Long-pressing a task or idea comment offers "Thêm thành ý tưởng" and "Thêm thành nháp món", opening the New idea or New draft form prefilled from the comment.
Partners can save something said in chat as an idea or a draft without retyping it (ticket #51, mockup group C of #15).
Verified by unit tests (first sentence, cuts, params, menu builder) and the full test, lint and build gates; the gestures and screens were not run on a phone.
Watch the long-press on a real phone (iOS sheet, Android dialog, screen-reader actions) and comment text with %, #, & or line breaks passing through the route.
Left: phone checks (added to #47), two open questions (copy to clipboard, storing the source), and #50 must merge first (this branch is stacked on it).

## Details

**Decisions**
- Mobile only, no Sensitive Area: saving uses the existing idea and draft create paths, so it queues offline like any new idea or draft.
- The "Từ bình luận của …" line is shown on the form only, not stored (open question 2).
- "Sao chép" from mockup C1 is left out: the app has no clipboard module (open question 1).
- The comment travels to the form as route params (text capped at 1000 code units), like the `fromIdea` flows.
- Branch stacked on `claude/ourkit-50-idea-to-draft`; the PR targets that branch.

**Review**
- Two blocking findings, both fixed: prefilled title, name and note were cut by characters while the forms and the server count UTF-16 code units, so emoji-heavy comments could prefill text the form or server refuses. Now cut in code units without splitting a character. The same fix was applied to #50's draft name/note prefill on its own branch.
- Non-blocking, left: no render test that the bubble wires the long-press and accessibility actions (covered by the phone check); route-param round-trip of special characters not verified (phone check); this change's mockup is not yet approved by the user.

**QA**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | R1: menu title and three items on task and idea comments | CommentBubble long-press → action sheet / Alert; commentMenu unit tests | 🙋 by hand |
| 2 | R2: own, others', waiting comments; not while editing | commentMenu returns null only while editing; unit-tested | 🙋 by hand |
| 3 | R3: screen-reader actions | accessibilityActions addAsIdea/addAsDraft; unit-tested | 🙋 by hand |
| 4 | R4: idea title = first sentence, description = whole comment | ideaFromComment on the AC comment gives the exact title | 🙋 by hand |
| 5 | R5: draft name ≤60 at a word, note ≤500 | draftFromComment unit-tested incl. code-unit cuts | 🙋 by hand |
| 6 | R6: first-sentence rule | commentSource.test.ts, all cases pass | ✅ pass |
| 7 | R7: source line and fallback | sourceLine unit-tested; not seen rendered | 🙋 by hand |
| 8 | R8: offline save, back returns | normal create paths, push navigation (code) | 🙋 by hand |
| 9 | R9: comment unchanged | no comment write in the diff (code) | 🙋 by hand |
| 10 | Tests, lint, build | gate test (mobile 1607/1607, API pass), build, lint all pass | ✅ pass |

**Not verified:** everything on a phone or simulator (criteria 1–5, 7–9).
