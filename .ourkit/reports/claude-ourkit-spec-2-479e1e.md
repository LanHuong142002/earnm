# Change Report: People can create an account and sign in on iPhone (#2)

## Summary

What changed: email and password sign-up, sign-in, sign-out and profile endpoints in the Express API on a first Prisma schema (`User`, `Session`), plus sign-in, sign-up, home and settings screens on iPhone with VI/EN and the new DESIGN.md.
Why: every later feature needs to know who the person is, and this sets up the shared database connection, error format, sessions and bilingual UI they reuse (Epic decisions 1, 10, 12).
How it was verified: 89 API tests against a real Postgres test database with a controllable clock, mobile lint (including no hard-coded text) and typecheck, API build, and five review rounds with a separate Sensitive Reviewer.
What to watch for: the sign-in limits are kept in memory for a single API process, and #3 must set `TRUST_PROXY` to Render's real hop count and serve the API over HTTPS.
What's left: nothing has run on a real iPhone yet (see the Test Handoff), and 10 minor non-blocking findings stay open as listed below.

## Details

### Decisions

- **Hand-built auth over Better Auth.** Better Auth didn't meet the spec as written: its docs don't say tokens are hashed in the database, its rate limit is per IP only, and its error shape differs. Node's built-in `crypto.scrypt` hashes passwords, so no native module is needed on Windows or Render.
- **Opaque server sessions over JWT.** A token is 32 random bytes, and only its SHA-256 hash is stored. A session expires 90 days after it was last used, and sign-out revokes it at once.
- **Sign-up asks for a display name.** The language preference is null until the person picks one, so the app follows the phone's language until then.
- **Sign-in limits:** 5 failures per email from one IP, 50 per email from any IP, and 20 per IP, each over a 15-minute window, with IPv6 addresses grouped by /64. Sign-up is limited to 10 valid attempts per IP per 15 minutes. Attempts already in flight are counted, so parallel requests can't get past a limit.
- **`TRUST_PROXY`** defaults to 0, so a client can't fake its IP with `X-Forwarded-For`.
- **Tests run against a local test database.** The user chose a test database over an in-memory substitute, and in practice used a separate `earnm_test` database on Neon. Test setup refuses to run unless the database name ends in `_test` and differs from `DATABASE_URL`.
- **Design:** DESIGN.md (orange accent, Plus Jakarta Sans, light and dark mode, compact and uncluttered) was agreed during this change and applied to the four screens as task 9, with the plan re-approved.

### Review

- Five rounds by a general reviewer and a Sensitive Reviewer for auth, data, schema and public API. They recorded 50 findings, 6 of them blocking. All blocking findings were fixed:
  - parallel sign-ins could get past the limit;
  - the client IP could be spoofed through `trust proxy`;
  - a language choice that failed to save was lost silently;
  - sign-out waited on an unreachable server.
- Most non-blocking findings were fixed at the user's request. Among them:
  - user and session are now created in one transaction;
  - sign-up has its own limit;
  - logs carry no personal data;
  - only the right field is marked when there's an error;
  - requests time out after 15 seconds;
  - the timeout also covers reading the response body;
  - passwords and names are normalised to NFC and their length counted in characters;
  - expired sessions are cleaned up;
  - the Keychain is cleared after a reinstall;
  - touch targets are 44pt;
  - the home screen has loading and offline states;
  - the Prisma client is generated before build and test.
- Still open, all non-blocking:
  - **Assigned to #3, noted on the issue:** HTTPS (8) and the exact `TRUST_PROXY` hop count (17).
  - **Accepted:** an attacker with many IPs can still hit the email-wide limit (38), and a request already in flight during sign-out can still complete (40).
  - **Mobile edge cases:** a failed Keychain delete combined with an offline sign-out (45); a failed write of the install marker (46); a launch where loading the profile returns a 500 shows the loading state indefinitely (48); after an offline launch the profile is only refetched on a cold start (49); a failure to write the install marker signs the person out on every launch (50).
  - **API:** `TRUST_PROXY` has no upper bound (47).

### QA

This change has no QA Stage, so there is no QA table. The acceptance criteria for R1–R14, R12a–b, R25, R27 and R28 are covered by the API tests. The rest are in the Test Handoff below.

### Not verified

- **On a device (Test Handoff):** sign up, reopen the app, sign out and sign in; sign out elsewhere and reopen; Airplane mode at launch; each error message; a double tap on submit; the phone set to Vietnamese or French before sign-in; choosing English and seeing it on a second phone; light and dark mode on an SE-sized and a Pro Max-sized iPhone; Vietnamese diacritics in Plus Jakarta Sans; entrance, press and error-shake motion, and fades only with Reduce Motion on; reinstalling the app starts signed out.
- **Test database stability:** the shared Neon test database was briefly unreachable during the last review round (P1001). The test Gate passed on the final code once it was back.
