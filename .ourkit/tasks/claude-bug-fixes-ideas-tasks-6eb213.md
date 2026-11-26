# Tasks: Ideas like/dislike, comment layout and assignee picker fixes

Spec: `.ourkit/specs/claude-bug-fixes-ideas-tasks-6eb213.md`. Plan: `.ourkit/plans/claude-bug-fixes-ideas-tasks-6eb213.md`. Mockup: `.ourkit/mockups/claude-bug-fixes-ideas-tasks-6eb213.html`.

## Tasks

### 1. API: like and dislike counts on every idea response

In `apps/api/src/ideas/response.ts`, make `ideaResponse` add `likeCount` (number of votes with value 1) and `dislikeCount` (number with value -1), counted from the `votes` it already loads. Keep `score` and `myVote` unchanged. Write the test first in `apps/api/src/ideas/routes.test.ts`: an idea with two +1 votes and one -1 vote returns `likeCount: 2`, `dislikeCount: 1`, `score: 1` from the list route, the detail route and the vote route (PUT votes). Run the API suite alone (shared test DB).

Depends on: none
Verify: `ourkit gate run test` (API tests pass, new test failed before the change)

### 2. Mobile data: counts in the Idea type, cache and optimistic vote

In `apps/mobile/src/ideas/types.ts` add `likeCount: number` and `dislikeCount: number` to `Idea`. In `src/ideas/overlay.ts`, `withVote` also removes the old vote from its count and adds the new one (0→1, 1→0, 1→-1, -1→1, -1→0, 0→-1), and the new-idea default sets both counts to 0. In `src/ideas/store.ts`, `isIdea` accepts an idea missing the counts, and the cache read fills them as `likeCount = max(score,0)`, `dislikeCount = max(-score,0)` so ideas cached by the old app version are kept. If ideas come from the API without the counts (server not yet deployed), the adapter in `src/ideas/adapters.ts` / `src/ideas/api.ts` applies the same fill. Update fixtures (`src/ideas/fixtures.ts`) and any typed test data. Don't change `src/ideas/order.ts`. Tests first: `overlay.test.ts` count cases, `store.test.ts` old-cache case.

Depends on: none
Verify: `ourkit gate run test` (mobile `tsc --noEmit` and Vitest pass)

### 3. Mobile UI: thumbs like/dislike controls with separate counts

In `apps/mobile/src/ideas/VoteControls.tsx`: `VoteColumn` (ideas list row) becomes a column of two buttons, like on top, dislike under it; each button is an Ionicons icon (`thumbs-up`/`thumbs-down` filled in `accentStrong` when it is the viewer's vote, `-outline` in textSecondary otherwise) with its count on the same row to the right of the icon, not under it. Keep 44px-tall touch targets. `BigVote` (idea detail) becomes two buttons with icon + count side by side and no text label (pressed style as now: accent border, tile background). Props take `likeCount`, `dislikeCount`, `myVote`, `onVote(1 | -1)`; update callers in `src/ideas/IdeaRow.tsx` and `src/app/(app)/(home)/projects/[id]/ideas/[ideaId]/index.tsx`. In `src/i18n/en.json` and `vi.json` remove `ideas.voteUp`/`ideas.voteDown`, replace `voteUpA11y`/`voteDownA11y` with like/dislike accessible labels that include the count and the viewer's vote (en "Like, {{count}} people. {{mine}}", vi "Thích, {{count}} người. {{mine}}", same pattern for dislike; `voteMine` texts become "you liked this"/"you disliked this"/"you haven't voted" and vi equivalents), and drop "Score" from `ideas.rowA11y`. Put the label-building logic in a pure function (e.g. in `src/ideas/screenView.ts`) and test it. Match the mockup screens 1 and 2 and DESIGN.md tokens.

Depends on: 2
Verify: `ourkit gate run test` and `ourkit gate run lint`; look on the phone is part of the Test Handoff

### 4. Mobile UI: scroll-into-view helper in Screen

In `apps/mobile/src/ui/Screen.tsx`, keep refs to the ScrollView, its scroll offset and visible height, and provide a context hook `useScrollIntoView()` returning `scrollIntoView(viewRef)` (a no-op outside a Screen). It measures the view relative to the scroll content with `measureLayout` and scrolls just enough that the view's bottom sits above the visible bottom with a `spacing[3]` margin (never scrolling up past the view's top). Put the position maths in a pure function in `src/ui/scrollIntoView.ts` with tests (`scrollIntoView.test.ts`): target below the fold, already visible (no scroll), taller than the viewport (align top), near the end of content.

Depends on: none
Verify: `ourkit gate run test`

### 5. Comments: list before input, input kept visible while typing

In `apps/mobile/src/tasks/comments/CommentsSection.tsx`, render `CommentComposer` after the list, error/loading/empty states and "load more", so it is the last thing in the section (both idea and task detail use it). In `src/tasks/comments/CommentComposer.tsx`, on focus wait for the keyboard (`Keyboard.addListener("keyboardDidShow")`, or the next frame if it is already visible) and call `scrollIntoView` on the composer's wrapper; call it again on `onContentSizeChange` while focused. Clean up listeners on blur/unmount. Then check on an Android phone (`npm run dev:phone` from this checkout) whether the screen resizes for the keyboard; if it doesn't, set `behavior="padding"` on Android too in `src/ui/Screen.tsx`'s KeyboardAvoidingView. Report what you found.

Depends on: 4
Verify: `ourkit gate run test`; keyboard behaviour on iOS and Android is a Test Handoff check for the user

### 6. Assignee picker: avatars and scroll on open

In `apps/mobile/src/tasks/AssigneeField.tsx`, add an `Avatar` (from `src/ui/Avatar.tsx`) with `initialOf(displayName)` (from `src/members/avatarRow.ts`) to each row, `muted` for former members, as in mockup screen 4. After the list opens, call `scrollIntoView` on the list card on the next frame (`requestAnimationFrame`). Keep the checkbox role and accessibility labels as they are.

Depends on: 4
Verify: `ourkit gate run test` and `ourkit gate run lint`; scroll and look are a Test Handoff check for the user
