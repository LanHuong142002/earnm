# Change Report: Assignees are reminded about tasks by push notification (#10)

## Summary

Tasks can have up to 5 reminders (once, daily, weekly on chosen days, monthly, optional end date) for chosen members. Phones schedule them as local notifications, and the server pushes through Expo to phones that haven't synced a change yet.
This answers ticket #10 (Epic F9, Decision 5). The user chose a free path (option B): local notifications plus Expo push while the team uses Expo Go.
Verification: `gate run test` passes (API 543, mobile 855), lint and build pass, there were two reviews plus a Sensitive Area review, and QA ran against the spec. 19 criteria pass by test, 11 need an iPhone, and none failed.
Watch for: push needs `npx eas init` and the cron-job.org tick, and push through Expo Go on SDK 58 is untested. Migrations `20261118120000`–`123000` must come before #11's `20261118130000`.
Left: hand checks on an iPhone (#44), and the user's service setup for push.

## Details

**Decisions**
- Any member adds, edits and deletes reminders. Limits are 5 per task and 20 recipients.
- Phones schedule the next 14 days, at most 64 notifications (the iOS limit). Monthly reminders fall on the start day, or on the month's last day if it's shorter.
- Option B (user, 2026-11-18). The server never pushes when a reminder changes. Each `/internal/tick` pushes due occurrences only to recipients with no device that fetched that project's reminders after the reminder's last change or its latest "Nhắc kèm" comment, so a phone never shows the same occurrence twice.
- Each push is sent once per occurrence per user. A failed or interrupted send is retried up to 3 times within an hour, and an advisory lock stops two ticks from running at once.
- Push is off on the phone without an EAS project id. Local notifications still work.

**Review**
- First review, 1 blocking finding. The device was stamped as synced on the task-list fetch, before reminders were fetched, so a failed reminders fetch could lose a reminder. Fixed: the stamp is now per project and set only on a successful reminders fetch.
- Sensitive Area review, no blocking findings. The issues it raised are fixed:
  - stale project syncs on a moved token
  - the token cap could drop the newest token
  - the retry comment was misleading
- Every remaining non-blocking finding was fixed at the user's request:
  - the tick scan is narrowed in SQL
  - only the latest 3 "Nhắc kèm" comments per task are fetched in SQL
  - push retries
  - the tick lock
  - sign-out now runs every provider's cleanup. This was an existing bug: one provider's cleanup overwrote another's.
- Re-review of those fixes: no blocking findings. Small comment and format nits were fixed.

**QA**: criteria 1–14, 16, 19–21 and 30 pass by test. Criteria 15, 17, 18 and 22–29 need an iPhone. The full table is in `node .ourkit/kit/bin/ourkit.js qa table`.

**Not verified**
- Nothing has run on a phone: screens, firing on a locked phone, tap navigation, the permission sheet, offline, dark mode and VoiceOver.
- Expo push in Expo Go has not been tried.
- The real Expo sender's per-message result mapping is untested, because only the fake sender is tested.
- The migrations were not applied to a database that already has data.
- The steps are in #44.
