# Change Report: Ideas like/dislike, comment layout and assignee picker fixes

## Summary

Ideas now use thumbs like/dislike icons with separate counts (API adds likeCount/dislikeCount), comments sit above their input, the input and the assignee list scroll into view, and assignees have letter avatars.
These were usability bugs reported from the phone: a single shared score was unclear, the comment box hid behind the keyboard, and the assignee list opened off-screen.
Verified by API tests (867 pass, new test for the counts), mobile tsc + Vitest (1540 pass), lint and build, two reviewers (no blocking findings) and QA by code reading.
Watch Android keyboard padding (now "padding" on every Screen, per Expo's edge-to-edge guidance) and deploy the API before or with the app, or counts are guessed from score.
Left: by-hand phone checks for criteria 1–3 and 7–10 (issue #47 section K), and the status-row restyle from #52, which this change does not cover.

## Details

**Decisions**
- Counts are computed from the votes the API already loads; `score` and `myVote` stay, so older app builds keep working. No schema change.
- Ideas list order is unchanged (user: just show the two numbers).
- Comment order and keyboard scrolling apply to idea and task detail, since they share one component (user's choice).
- Avatars are letter circles, reusing the members/comments `Avatar`; photo avatars are out of scope.
- New app vs. old cache or old server: missing counts are filled from score (`max(score,0)`, `max(-score,0)`) until the next fetch, so offline users keep their cached ideas.
- Scroll-into-view is a small helper in `Screen` (measureLayout + scrollTo), with the maths in a tested pure function; no new dependency.
- Android: `KeyboardAvoidingView` behavior is now "padding" on both platforms. Expo's keyboard guide says Expo apps are edge-to-edge on Android, the window no longer resizes, and a view without a behavior stays under the keyboard. RN's implementation pads only the overlap, so a device that still resizes gets no extra padding.

**Review** (ourkit-reviewer and ourkit-sensitive-reviewer, no blocking findings)
- Resolved: Android padding double-applying. Verified against Expo docs and RN's `KeyboardAvoidingView` overlap calculation; comment added in `Screen.tsx`.
- Open, non-blocking: fallback counts are guesses for old caches/servers (display only, self-correcting); no scroll with a hardware keyboard (input isn't covered then); separate counts reveal more about how members voted than score did (what the spec asks for); deploy the API before or with the app build.

**QA**

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | Ideas list rows show thumbs-up and thumbs-down each with its own number; 3 likes and 1 dislike show 3 and 1. | Code reading; not seen on a device. Test Handoff in issue #47 section K. | 🙋 by hand |
| 2 | Idea detail shows thumbs icons with counts and no "Support"/"Against" text in either language. | Code reading and i18n grep; not seen on a device. Test Handoff in #47 K. | 🙋 by hand |
| 3 | Like / unlike / switch update counts and pressed state, also offline, and sync after reconnecting. | Count arithmetic covered by overlay/voteCounts/store tests (pass); device behaviour in #47 K. | 🙋 by hand |
| 4 | API returns likeCount 2, dislikeCount 1, score 1 from list, detail and vote routes. | routes.test.ts new test; API suite 867/867 passed. | ✅ pass |
| 5 | List order unchanged. | order.ts unchanged; existing ordering tests pass. | ✅ pass |
| 6 | Comments appear above the comment input on idea and task detail. | Code reading of shared CommentsSection; not seen rendered. | ✅ pass |
| 7 | Comment input scrolls above the keyboard and stays visible while typing, idea and task detail. | Helper unit-tested; needs a real phone, iOS and Android. #47 K. | 🙋 by hand |
| 8 | Opening the assignee picker scrolls the list into view. | Code reading; needs a phone. #47 K. | 🙋 by hand |
| 9 | Each assignee has a letter avatar matching their initial. | Code reading; not seen on a device. #47 K. | 🙋 by hand |
| 10 | Screen reader reads like/dislike with counts and the viewer's vote; parity test passes. | parity.test.ts passes; screen reader not tried. #47 K. | 🙋 by hand |

**Not verified:** nothing was run on a phone or simulator. All on-screen behaviour (icons, layout against the approved mockup, keyboard on iOS and Android, assignee scroll, screen reader) waits for the user's check in issue #47 section K.
