# Plan: A comment can be saved as an idea or a drink draft (#51)

Spec: `.ourkit/specs/claude-ourkit-51-comment-to-idea.md`. Mockup: `.ourkit/mockups/claude-ourkit-51-comment-to-idea.html` (waiting for the user's approval).

## Approach

Mobile only. Add a long-press menu (and matching accessibility actions) to `CommentBubble`, shown when the bubble isn't being edited. Picking an item pushes the existing New idea or New draft screen with route params carrying the source: `fromComment=1`, the comment text, the author's name (or empty) and the task or idea title. Both forms read those params, prefill their fields through one pure helper, show the source line, and save through their normal create (queued, offline-capable). No API or schema change.

Route params over an in-memory hand-off: the text is at most 1000 characters, params survive a reload of that screen, and the New task / New draft "from idea" flows already pass their source the same way (`fromIdea`).

## Prior Art

- `CommentsSection.tsx` `showSortMenu`: action sheet on iOS, `Alert` buttons elsewhere. **Reuse the same pattern** for the comment menu (extract a tiny helper if both use it).
- `ideas/taskPrefill.ts`, `ideas/draftPrefill.ts` (#50) with `draftNameFromTitle` (cut at a word boundary, counting characters): **reuse** the cutting helper for both 120 and 60, generalised if needed.
- `ideas/plan.ts` `TITLE_MAX`/`DESCRIPTION_MAX`, `drafts/view.ts` `DRAFT_NAME_MAX`/`DRAFT_NOTE_MAX`, `tasks/comments/view.ts` `COMMENT_MAX`: **reuse** the limits.
- `Parent` (`tasks/parent.ts`) has no title: **add** an optional `title` set by `taskParent` and `ideaParent`, so the section can name the source.
- No clipboard module in the app: "Sao chép" is not built (spec).

## Changes

- New `tasks/comments/commentSource.ts`: `firstSentence(text)` (R6), `ideaFromComment(source)` and `draftFromComment(source)` returning prefilled fields (R4, R5), `sourceLineKey(authorName)` choosing the line or the fallback (R7), and `commentSourceParams` / `readCommentSource(params)` to build and parse the route params safely (ignore anything malformed, cap lengths).
- `tasks/parent.ts`: optional `title` on `Parent`; `taskParent` and `ideaParent` set it.
- `tasks/comments/CommentBubble.tsx`: `onLongPress` and `accessibilityActions` (`addAsIdea`, `addAsDraft`) when not editing (R1–R3), calling a new `onAddAs(kind)` prop. Menu title "Bình luận của <name>". Mockup C1, C1b.
- `tasks/comments/CommentsSection.tsx`: passes `onAddAs` that pushes `/projects/[id]/ideas/new` or `/projects/[id]/drafts/new` with the params (R8 back behaviour comes from push).
- `app/(app)/(home)/projects/[id]/ideas/new.tsx`: read the source params, initialise title and description once, show the source line (mockup C2, C4).
- `app/(app)/(home)/projects/[id]/drafts/new.tsx`: same for the plain draft form (not the `fromIdea` path): name and note, source line (mockup C3).
- `i18n/vi.json`, `en.json`: menu items, a11y action labels, source line and fallback.

Navigation map: comment (task or idea detail) → long-press → item → push New idea / New draft. Huỷ or back → back to the comment's screen. Save → whatever the normal form does today (it replaces to the new item), so back from the new item returns to the comment's screen.

## Risks

- No Sensitive Area: no API, schema, auth or money change; saving uses existing, reviewed create paths.
- Long-press conflicting with existing gestures on the bubble (edit/delete actions, scrolling). The menu opens only on long-press, not tap; checked on a phone (Test Handoff).
- Route params with arbitrary user text: parsed defensively and length-capped; text is only shown in fields, never interpreted.
- #51 stacks on #50's branch; if #50 changes in review, rebase #51.

## Test Strategy

Commands: `ourkit gate run test`, `ourkit gate run lint`, `ourkit gate run build`.

- R6, R4, R5, R7: unit tests in `commentSource.test.ts` (sentence endings ".", "!", "?", "…", line break, "3.5k", whitespace only, emoji cuts, 120/60/500 limits, fallback line, malformed params).
- R1–R3: unit test of the menu/accessibility-action builder (items, title, absent while editing) if extracted as a pure function; the gesture itself goes to the Test Handoff.
- R8, R9: Test Handoff on a phone (offline save of both, cancel/back, comment unchanged).
- i18n parity test covers the new keys.
