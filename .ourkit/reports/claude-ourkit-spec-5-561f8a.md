# Change Report: Owners can invite people with a single-use link (#5)

## Summary

What changed: Owners can invite people with a single-use 7-day code shared through the iOS share sheet. The code also opens an API-served invite page. Everyone in a project can see its members, Owners can promote, demote and remove them, and anyone can leave. On the phone there's an avatar row, a Members screen, a Join screen and a profile card.
Why: projects could only gain members through the database, so partners couldn't actually share a project (Epic F4, Decisions 2 and 3).
How it was verified: API 299 tests on a real test database (including race tests looped 5 times), mobile 240 tests, lint and build pass. QA: 23 criteria from tests, and 5 checked by the user on an iPhone against this branch's API.
Watch for: two additive migrations on `Invite`; Owner checks repeated under a project row lock (including on existing PATCH and DELETE `/projects/:id`); set `TRUST_PROXY` before real use, because the invite limits are per IP.
What's left: 11 non-blocking review findings (listed below), issue #28 for the self-remove error code, and the optional env vars `INVITE_INSTALL_URL` and `INVITE_CODE_KEY` on Render.

## Details

### Decisions

- **Codes:** 8 characters from a 31-character alphabet with no look-alikes, generated with `crypto.randomInt`. Only an HMAC-SHA256 of each code is stored. The key comes from the optional `INVITE_CODE_KEY`, or from `INTERNAL_SECRET` when that's unset; changing whichever key is in use voids pending invites. The plain code is returned once, when the invite is created.
- **Concurrency:** every membership change, join, invite create and revoke, and project edit and delete locks the Project row (`SELECT ... FOR UPDATE`) and re-checks the caller's role under the lock. This keeps the last-Owner rule, the 50-member cap, the 20-pending cap and single use correct under races.
- **R7 changed during Review, by the user's choice:** removing a member revokes the pending invites they created, and nobody can join with an invite they created. Invites still survive their creator being demoted or leaving.
- **Added during Review, beyond the spec:**
  - at most 50 invites created per project in 24 hours;
  - a code collision is retried;
  - optional `INVITE_CODE_KEY`;
  - an index on `Invite(projectId, createdAt)`.
- **Invite page:** `GET /i/:code` is self-contained HTML with no scripts, every value escaped, a strict CSP, `no-store`, `no-referrer`, `noindex` and `nosniff`. It is Vietnamese unless `Accept-Language` prefers English. Every dead code gets one identical 404 body. It is rate-limited per IP.
- **Phone:**
  - Avatar row: single-tone initials in the `avatar` tokens, and `DESIGN.md` updated to allow them. The row is hidden until a member list has loaded.
  - Losing access: a refresh that no longer lists a project drops its queued writes and its cached member names, guarded against an account switch during the refresh.
  - Joining and leaving update the local list immediately.
  - Network: invites, joining and member changes are online-only and never queued.

### Review

There were three rounds, each with the general reviewer and the Sensitive Area reviewer, run one after another.
- **Blocking, all fixed:**
  - Dead codes revealed `already_member` or `project_full` instead of `invalid_invite`.
  - The Members screen spun forever after removal.
  - AC26 had no real migration test.
  - A slow refresh during an account switch could drop the next person's queued edits.
  - A removed Owner could rejoin with their own codes.
- **Non-blocking fixed by the user's choice:** findings 4, 5, 6, 8, 10, 11 and 12–17.
- **Non-blocking still open:**
  - The member list query has no `take` (it is bounded by the 50 cap on join).
  - The daily invite cap answers `too_many_attempts`, which reads like a sign-in lockout, and isn't in the spec.
  - `docs/deploy.md` and `code.ts` still say codes are always keyed from `INTERNAL_SECRET`.
  - A local storage failure right after a successful join shows an error.
  - The code travels in the URL path, so edge logs and chat link previews see it.
  - Response timing differs between unknown and dead codes.
  - There is no down migration.
  - An Owner who leaves keeps working invites (R7).
  - Dropping queued writes assumes `GET /projects` stays unpaged.
  - The profile email stays in AsyncStorage after a session expires.
  - #7 (self-remove error code) is issue #28.

### QA

| # | Acceptance Criterion | How it was checked | Result |
|---|---|---|---|
| 1 | **AC1 (reqs 1, 25):** an Owner creates an invite and gets 201 with a code and an expiry 7 days out. A Member gets 403, and a non-member gets 404. | API tests on the _test DB: owner creates an invite expiring in 7 days (201); member 403, non-member and bad id 404. | ✅ pass |
| 2 | **AC2 (req 2):** generated codes use only the allowed alphabet. Joining with lowercase, spaces or dashes succeeds. | Tests: generated codes use only the 31-character alphabet and 8 characters; joining accepts lowercase, spaces and dashes. | ✅ pass |
| 3 | **AC3 (reqs 3, 15):** an invite with an expiry in the past gives `invalid_invite`. A used one gives `invalid_invite` to a second person. | Test: one identical invalid_invite body for unknown, malformed, used, expired and revoked codes; used and expired cases also covered separately. | ✅ pass |
| 4 | **AC4 (req 4):** with 20 pending invites, a 21st gets 409 `too_many_invites`. After revoking one, creating succeeds. | Test: refuses a 21st pending invite with 409 too_many_invites and allows one after a revoke. | ✅ pass |
| 5 | **AC5 (req 5):** the stored invite row doesn't contain the plain code. Listing pending invites returns no code. | Test: stores only an HMAC of the code; listing pending invites returns no code. | ✅ pass |
| 6 | **AC6 (req 6):** an Owner lists pending invites and revokes one, after which joining with it gives `invalid_invite`. Revoking it again gives success. A Member can't list or revoke. | Tests: revoked invite gives invalid_invite on join, revoking again succeeds; members and non-members can't list or revoke. | ✅ pass |
| 7 | **AC7 (req 7):** the creating Owner is demoted, and the invite still works. Deleting the project removes its invites. When the creating Owner is removed, their pending invites are revoked (another person's join gives `invalid_invite`) while invites created by others stay pending. A person joining with an invite they created, after leaving, gets `invalid_invite`. | Tests: demoted creator's invite still works; project delete removes invites; removing the creating Owner revokes their pending invites while others' stay pending; an Owner who left gets invalid_invite with their own invite. | ✅ pass |
| 8 | **AC8 (reqs 9, 12):** the valid-code page returns 200 HTML with the project name, inviter name, formatted code and install steps, and the listed headers. A project name containing `<script>` appears escaped. The unknown, used, revoked and expired cases each return the same 404 body with no project name. | Tests: pending invite page renders escaped project and inviter names with the required headers; unknown, malformed, used, revoked and expired give one identical 404 body without the project name. | ✅ pass |
| 9 | **AC9 (req 10):** `Accept-Language: en-US,en;q=0.9` gives English. No header, or `vi`, gives Vietnamese. | Test: en-US,en;q=0.9 gives English; no header or vi gives Vietnamese. | ✅ pass |
| 10 | **AC10 (req 11):** with `INVITE_INSTALL_URL` set, the page links to it. Unset, the step says to ask the inviter. A non-https value makes config loading fail (unit test). | Tests: install link only when INVITE_INSTALL_URL is set, ask-the-inviter step otherwise; config.test.ts rejects http, ftp, javascript: and non-URL values without echoing them. | ✅ pass |
| 11 | **AC11 (reqs 13, 19):** repeated page lookups or join attempts past the limit get 429. Parallel join attempts can't exceed the limit. | Tests: the 61st page lookup in the window is 429 with the generic page then recovers; 429 too_many_attempts after 10 failed joins; parallel attempts never exceed the account limit. | ✅ pass |
| 12 | **AC12 (reqs 14, 27):** after joining, the person's `GET /projects` includes the project with role `member`. | Test: joining adds the person as member and their GET /projects includes the project with role member. | ✅ pass |
| 13 | **AC13 (req 16):** an existing member using a code gets 409 `already_member`, and the invite still works for someone else. | Test: an existing member gets 409 already_member and the invite stays usable for someone else. | ✅ pass |
| 14 | **AC14 (req 17):** with 50 members, joining gets 409 `project_full` and the invite stays pending. | Test: at 50 members joining gets 409 project_full and the invite stays pending. | ✅ pass |
| 15 | **AC15 (req 18):** two concurrent joins with one code produce exactly one new member and one `invalid_invite`. | Tests: two concurrent joins with one code give exactly one member; joins racing at the cap never exceed 50. | ✅ pass |
| 16 | **AC16 (req 20):** a Member lists members and gets names, roles and join times in the stated order, with no email field. A non-member gets 404. | Tests: member list has owners first then join order, stable tie-break, no email field; non-member 404. | ✅ pass |
| 17 | **AC17 (reqs 21, 22):** an Owner promotes a Member, demotes another Owner, demotes themselves while another Owner exists, and removes a Member and an Owner. Each change shows in the list. | Tests: owner promotes a member, demotes another owner, demotes self with another owner present, removes a member and an owner; each change shows in the list. | ✅ pass |
| 18 | **AC18 (req 24):** the sole Owner gets 409 `last_owner` on demoting themselves and on leaving. Removing the only other Owner while the remover stays Owner is allowed. Two Owners demoting each other concurrently leave at least one Owner. | Tests: sole owner gets last_owner on self-demote and on leave; two owners demoting each other or leaving at once keep at least one owner. | ✅ pass |
| 19 | **AC19 (req 26):** after being removed, the person gets 404 on `PATCH /projects/:id` and on the member list. Their other projects still work. | Test: a removed person gets 404 on the project and its members, while their other project still works. | ✅ pass |
| 20 | **AC20 (req 23):** a Member leaves, and the project disappears from their `GET /projects`. | Test: a member leaves and the project drops from their GET /projects. | ✅ pass |
| 21 | **AC21 (req 33, mobile unit test):** a refresh after the project is no longer returned drops it from the cache and drops its queued writes. The routing decision sends the person to the list. | Mobile tests: a refresh no longer returning a project drops its queued update and removes it; member cache is pruned; routing leaves (never a spinner) when the project is gone. | ✅ pass |
| 22 | **AC22 (req 29, QA by hand on iPhone):** each move in the navigation map opens the stated screen, and back and swipe-back return as stated. | Checked by the user on iPhone with this branch's API (npm run dev:phone): reported "ok rồi đó". Calls take about 1-2s against the dev database in us-east-2 (measured 226ms per query), expected to be fast in production in Singapore. | 🙋 by hand |
| 23 | **AC23 (reqs 30–32, 34, QA by hand on iPhone):** the Invite button opens the share sheet with the message in the app language. The code entered in Join opens the project. Each error message appears for its case. Pending invites start collapsed. Members see no manage actions. | Checked by the user on iPhone with this branch's API (npm run dev:phone): reported "ok rồi đó". Calls take about 1-2s against the dev database in us-east-2 (measured 226ms per query), expected to be fast in production in Singapore. | 🙋 by hand |
| 24 | **AC24 (req 28, QA by hand):** with the phone offline, Invite, Join and member actions show the offline message, and nothing is queued. | Checked by the user on iPhone with this branch's API (npm run dev:phone): reported "ok rồi đó". Calls take about 1-2s against the dev database in us-east-2 (measured 226ms per query), expected to be fast in production in Singapore. | 🙋 by hand |
| 25 | **AC28 (req 29a, a mobile unit test plus QA by hand on iPhone):** a pure function gives the row's contents: 1, 3, 4 and 50 members produce 1, 3, 3 and 3 avatars, no `+N`, no `+N`, `+1` and `+47`, and always a final `+`. The initial is the uppercase first letter of the name. On the phone, the avatars overlap with a visible ring, all share one colour, and tapping any part of the row opens the Members screen. A Member sees the same row. | Checked by the user on iPhone with this branch's API: reported "ok rồi đó". Unit part passes: avatarRow.test.ts covers 1/3/4/50 members, +N and the Vietnamese initial. | 🙋 by hand |
| 26 | **AC25 (req 35):** a test checks that `en.json` and `vi.json` have the same keys. | i18n/parity.test.ts checks en.json and vi.json have the same keys both ways. | ✅ pass |
| 27 | **AC26 (req 38):** the migration applies to a database that already has projects and members, and they are unchanged. | Test applies migrations up to projects in a fresh schema, seeds a project and members, applies the invites migration, and finds the rows unchanged and an empty Invite table. | ✅ pass |
| 28 | **AC27 (req 36, QA by hand on iPhone, plus a mobile unit test for the offline fallback):** the Account tab shows the signed-in person's display name and email above the language setting, with no edit control. After switching accounts it shows the new person's details. Offline, it shows the last known values. | Checked by the user on iPhone: the Account tab shows name and email correctly ("info ok rồi"). Unit tests cover the stored-profile owner check and the offline fallback. | 🙋 by hand |

### Not verified

- **Hand checks:** the user checked AC22–AC24, AC27 and AC28 on an iPhone and reported them as OK, without step-by-step notes.
- **VoiceOver:** not checked.
- **Production:** latency was not measured. Against the dev database in us-east-2, each query took about 226ms, so calls took 1–2s. Production runs in Singapore next to Render.
- **Migrations:** they were also applied to the shared dev database by `migrate dev`.
