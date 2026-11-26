# Spec: Ideas like/dislike, comment layout and assignee picker fixes

## Goal

Make voting on ideas read as a plain like / dislike with two separate counts, keep the comment box visible while typing, show comments before the comment box, and make the task assignee list easier to use (it scrolls into view and shows an avatar per person). These are usability bugs reported from using the app on a phone.

## Requirements

1. **Ideas list, separate counts.** Each idea row shows a like control (thumbs-up icon) and a dislike control (thumbs-down icon), each with its own number: how many members liked it and how many disliked it. The shared single score number and the up/down arrows are gone.
2. **Idea detail, like/dislike.** The vote control on the idea detail screen uses the same thumbs-up / thumbs-down icons with their own counts, and no longer shows the words "Support" / "Against" (or "Ủng hộ" / "Không").
3. **Voting behaviour is unchanged.** One vote per member per idea: tapping like or dislike sets it, tapping the active one again clears it, and switching moves the vote. The pressed state shows which one the viewer chose. Both counts update immediately (optimistically) and offline voting keeps working as it does now.
4. **API returns both counts.** Each idea in API responses (list, detail, vote, and any other route returning an idea) includes `likeCount` (number of +1 votes) and `dislikeCount` (number of -1 votes). Existing fields (`score`, `myVote`) stay so older app builds keep working. No database change.
5. **List order unchanged.** The ideas list order is not changed by this work; counts are only displayed.
6. **Comments before the box.** On both the idea detail and task detail screens, the comment list (with its heading, sort, empty/loading/error states and "load more") renders before the comment input, so the input sits at the bottom of the comments section.
7. **Comment input stays visible while typing.** On both screens, focusing the comment input scrolls the screen so the input is visible above the keyboard, and it stays visible as the user types (including when the input grows to several lines).
8. **Assignee list scrolls into view.** On the task new and edit forms, opening the assignee picker scrolls the screen so the opened list is visible.
9. **Assignee avatars.** Each person in the assignee list shows a round avatar with their initial (the same letter avatar used for members and comments), next to their name. Former members marked "former" also get one.
10. **Accessibility and translations.** Like/dislike controls have accessible names in English and Vietnamese that state the count and the viewer's own vote; the row accessibility label no longer says "Score". en and vi translations stay in parity.

## Acceptance Criteria

1. Open a project's Ideas list: each row shows a thumbs-up with a number and a thumbs-down with a number, no arrows, no shared number. With 3 likes and 1 dislike from different members, the row shows 3 and 1.
2. Open an idea: the vote area shows thumbs-up and thumbs-down icons with their counts, and no "Support"/"Against" text in either language.
3. Tap like: like count +1 and the like icon shows pressed. Tap like again: back to before. Tap dislike while liked: like -1, dislike +1. Same in airplane mode, and it syncs after reconnecting. Automated tests cover the count arithmetic for set, clear and switch.
4. API test: an idea with two +1 votes and one -1 vote returns `likeCount: 2`, `dislikeCount: 1`, `score: 1`, from list, detail and vote routes.
5. With ideas of differing votes, the list shows them in the same order as before this change.
6. On idea detail and task detail, existing comments appear above the comment input.
7. On a phone, tap the comment input on an idea with many comments and photos: the screen scrolls so the input is visible above the keyboard; typing several lines keeps the text visible. Same on task detail.
8. On task new/edit, with the assignee field near the bottom of the screen, tap it: the list opens and is scrolled into view.
9. Each person in the assignee list has a letter avatar matching their name's initial.
10. Screen reader reads like/dislike with counts and the viewer's vote; `src/i18n/parity.test.ts` passes.

## Out of Scope

- Image (photo) avatars or avatar upload; members only have names today.
- Changing how ideas are sorted, or sorting by likes.
- Likes on comments.
- Any database schema change.
- The read-only assignee line on task detail.

## Open Questions

None.
