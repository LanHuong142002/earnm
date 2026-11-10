# Lessons

- [cost] Each review round surfaces new non-blocking nits on the newest code; agree up front which severities get fixed so Review converges instead of looping.
- [quality] Rate limiters must reserve in-flight attempts and must not trust X-Forwarded-For by default; both slipped past the first plan.
- [quality] Two review rounds each produced opposite advice on the same test (real closed port is flaky vs injected fetch is weaker); decide test strategy for network failures in the plan so Review doesn't flip it.
- [cost] Running two reviewers in parallel on one shared test database caused false test failures; run reviewers one after another, or give each its own test database.
