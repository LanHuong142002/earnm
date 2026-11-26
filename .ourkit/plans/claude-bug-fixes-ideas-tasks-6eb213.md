# Plan: Ideas like/dislike, comment layout and assignee picker fixes

## Approach

Add `likeCount` and `dislikeCount` to the one place the API builds an idea response, counted from the votes it already loads, and keep `score`. On the phone, carry both counts through the Idea type, cache and optimistic vote overlay, then redraw the two vote controls with Ionicons thumbs icons and their own numbers. For the comment box and the assignee list, give the shared `Screen` a small "scroll this into view" helper (its ScrollView already wraps every screen), call it when the comment input gets focus or grows, and when the assignee list opens. Move the composer below the list in the shared `CommentsSection`, and add the existing letter `Avatar` to each assignee row.

## Prior Art

- Vote counting: `apps/api/src/ideas/response.ts` already loads every vote (`ideaInclude.votes`) to compute `score`; counting +1 and -1 there needs no new query. Reuse.
- Optimistic vote: `apps/mobile/src/ideas/overlay.ts` `withVote` already moves `score` by the vote difference; extend the same function to move the two counts. Reuse.
- Icons: `@expo/vector-icons` Ionicons is used everywhere and has `thumbs-up`, `thumbs-up-outline`, `thumbs-down`, `thumbs-down-outline`. Reuse.
- Avatar: `apps/mobile/src/ui/Avatar.tsx` (letter circle, `muted` variant) and `initialOf` in `apps/mobile/src/members/avatarRow.ts`, already used for members and comments. Reuse.
- Keyboard: `apps/mobile/src/ui/Screen.tsx` wraps all screens in KeyboardAvoidingView + ScrollView. The project has no keyboard library (no react-native-keyboard-controller) and no existing scroll-into-view code. Write a small helper in `Screen` instead of adding a dependency for one job: React Native's own `measureLayout` + `scrollTo` and the `Keyboard` events cover it.

## Changes

**API (Sensitive Area: public API, additive only)**
- `apps/api/src/ideas/response.ts`: `ideaResponse` adds `likeCount` (votes with value 1) and `dislikeCount` (value -1). Every route that returns an idea goes through it (list, detail, create, update, vote, status, to-task), so all get the fields. `score` and `myVote` unchanged.
- `apps/api/src/ideas/routes.test.ts`: assert the counts from list, detail and vote routes.

**Mobile data**
- `src/ideas/types.ts`: `Idea` gains `likeCount: number`, `dislikeCount: number`.
- `src/ideas/store.ts`: `isIdea` accepts an idea missing the counts (cached by the previous app version) and `read` fills them from `score` (`max(score,0)`, `max(-score,0)`) until the next fetch replaces it, so offline users don't lose their cached ideas after updating.
- `src/ideas/overlay.ts`: `withVote` also takes the old vote out of its count and adds the new one; the new-idea default sets both counts to 0. Any fixtures (`src/ideas/fixtures.ts`) get the fields.
- Ordering (`src/ideas/order.ts`) is not touched (R5).

**Mobile UI** (mockup screens in brackets)
- `src/ideas/VoteControls.tsx` [screens 1 and 2]: `VoteColumn` becomes a column of two buttons, each an Ionicons thumbs icon (filled + accentStrong when it is the viewer's vote, outline otherwise) with its count beside it on the right (same row, not stacked). `BigVote` becomes two buttons with icon + count, no text label. Props change from `score` to `likeCount`/`dislikeCount`; callers in `src/ideas/IdeaRow.tsx` and the idea detail screen updated.
- `src/i18n/en.json`, `vi.json`: remove `voteUp`/`voteDown` text; replace the a11y keys with like/dislike labels that include the count and the viewer's vote ("Like, 5 people. You liked this" / "Thích, 5 người. Bạn đã thích"); `rowA11y` drops "Score". Parity test keeps them in step.
- `src/tasks/comments/CommentsSection.tsx` [screen 2]: render `CommentComposer` after the list and "load more", for both idea and task detail.
- `src/ui/Screen.tsx` [screen 3, 4]: keep a ref to the ScrollView and its content, and provide a context hook `useScrollIntoView()` returning `scrollIntoView(viewRef)`. It measures the view relative to the scroll content and scrolls just enough that its bottom sits above the visible bottom (with `spacing` margin). The position maths is a pure function in `src/ui/scrollIntoView.ts` so it can be unit-tested.
- `src/tasks/comments/CommentComposer.tsx` [screen 3]: on focus, wait for the keyboard to show (`keyboardDidShow`, or the next frame if it is already up) and call `scrollIntoView` on the composer; call it again on `onContentSizeChange` while focused, so multi-line text stays visible.
- `src/ui/Screen.tsx` Android: `KeyboardAvoidingView` currently has no behaviour on Android. With edge-to-edge (Expo SDK 58), Android no longer resizes the window for the keyboard, which is the likely reason the input hides on Android. If a phone check during Build shows Android doesn't resize, set `behavior="padding"` on Android too; otherwise leave it. The result goes in the Test Handoff.
- `src/tasks/AssigneeField.tsx` [screen 4]: each `ChoiceRow` gets an `Avatar` with `initialOf(displayName)` (muted for former members); after opening, call `scrollIntoView` on the list card on the next frame.

## Risks

- **Public API (Sensitive Area):** change is additive; older app builds ignore the new fields, and the new app tolerates old cached ideas. A server running the old code (Render not yet deployed) would send no counts: the cache fallback above also covers that response shape, so the app shows counts derived from score rather than crashing.
- **Count drift in the overlay:** a wrong subtraction would show -1 or double counts. Pure unit tests cover set, clear and switch from every starting vote.
- **Keyboard behaviour differs by platform** and can't be tested in Vitest (logic-only setup). The scroll maths is unit-tested; the real behaviour on iOS and Android goes into the Test Handoff for a phone check (start with `npm run dev:phone` from this checkout, per lessons).
- **measureLayout timing:** measuring before the keyboard has resized the ScrollView gives a stale height; waiting for `keyboardDidShow` and re-running on layout avoids it.
- Comment order change also affects task detail; agreed in the spec.

## Test Strategy

Commands: `ourkit gate run test` (API + mobile Vitest, mobile runs `tsc --noEmit` first) and `ourkit gate run lint`. Tests are written first for each logic change.

- R1, R2 (icons, counts, no text): `VoteControls` is not render-tested (no component test setup); covered by type-checking, the a11y label helper tests, and the phone check in the Test Handoff.
- R3 (vote behaviour): `src/ideas/overlay.test.ts` adds count cases for 0→1, 1→0, 1→-1, -1→1, -1→0, 0→-1; existing `plan.test.ts`/`syncCycle.test.ts` keep covering toggling and offline sync.
- R4 (API counts): `apps/api/src/ideas/routes.test.ts` with two likes and one dislike on list, detail and vote routes.
- R5 (order): existing `src/ideas/listRules.test.ts` stays green, unchanged.
- R6 (comments before input): phone check (layout only).
- R7 (input visible): `src/ui/scrollIntoView.test.ts` for the scroll maths (target below fold, already visible, near the end of content); real keyboard on iOS and Android in the Test Handoff.
- R8 (assignee scroll): same helper tests; phone check.
- R9 (avatars): `initialOf` is already tested; phone check for the rows.
- R10 (a11y + translations): a test for the like/dislike label helper (count and "mine" text), and `src/i18n/parity.test.ts`.
- Store fallback: `src/ideas/store.test.ts` case for a cached idea without counts.

Review severities agreed up front (lessons): blocking findings get fixed; new non-blocking nits after round one go to the report.
