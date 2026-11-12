# Lessons

- [cost] Each review round surfaces new non-blocking nits on the newest code; agree up front which severities get fixed so Review converges instead of looping.
- [quality] Rate limiters must reserve in-flight attempts and must not trust X-Forwarded-For by default; both slipped past the first plan.
- [quality] Two review rounds each produced opposite advice on the same test (real closed port is flaky vs injected fetch is weaker); decide test strategy for network failures in the plan so Review doesn't flip it.
- [cost] Running two reviewers in parallel on one shared test database caused false test failures; run reviewers one after another, or give each its own test database.
- [quality] A spec with more than one screen needs a navigation map (which move opens what, where back goes); listing screens alone produced replace-based navigation with no back or swipe-back.
- [quality] Show a mockup and get approval before restyling screens; a token-level restyle (stripes, initials avatars, gradient) was rejected as AI-looking after it was built.
- [cost] Merging a feature PR from another session while this session still had unpushed commits split #4 across two PRs and left spec and code out of step; merge only from the session that owns the change.
- [quality] When a provider calls a tested pure decision function, make it act on every field the function returns; a tested cacheStep.show was ignored and leaked another account's projects.
- [quality] A spec that lets someone remove a member must say what that person loses besides membership (codes, links or tokens they saw); a removed Owner rejoining with their own invites was only caught in the third review round.
- [quality] Start phone QA of a branch with npm run dev:phone from that checkout; Expo on the default .env talks to Render (main), so new routes 404 and new UI silently hides.
- [cost] The dev database is in us-east-2 (~226ms per query from here), so lock-heavy endpoints take 1-2s in dev; measure before treating that as a code problem.
