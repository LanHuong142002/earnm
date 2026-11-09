# Spec: People can create an account and sign in on iPhone

Ticket: #2 (Epic F1). Tier: Feature. Sensitive Areas: auth, data, schema, public API.

## Goal

A shop partner can create their own earnm account with email, password and a display name, sign in on their iPhone, stay signed in across app restarts, and sign out. The app shows Vietnamese or English, following the phone's language until the person picks one, after which their choice is saved on their account.

This matters because every later feature (projects, tasks, invites, reminders) needs to know who the person is (Epic Decision 1). It also lays the shared groundwork later features reuse: the database connection and first schema and migration, password hashing, session tokens, the API error format, the mobile API client, and the bilingual UI (Decisions 10, 12).

Today the API has only `GET /health`, the Prisma schema has no models and no migrations, and the mobile app is a placeholder screen with no API client, secure storage or translations.

## Requirements

### Accounts

1. A person can sign up with an email address, a password and a display name.
2. Email is trimmed and compared case-insensitively; it is stored in lowercase. It must be a syntactically valid address of at most 254 characters.
3. A password must be 8 to 128 characters long. There are no other composition rules. Passwords are never stored or logged in readable form; only a slow, salted password hash is stored.
4. A display name is trimmed and must be 1 to 50 characters long.
5. Signing up with an email that already has an account is refused with a message saying that email is already in use; no second account is created, even when two sign-ups for the same email arrive at the same time.
6. A successful sign-up signs the person in immediately (no email verification step).

### Sessions

7. A person can sign in with their email and password. A wrong email and a wrong password give the same error message, so the response doesn't reveal whether an account exists.
8. Successful sign-up or sign-in returns a session token: a random, unguessable value. The server stores only a hash of it, so a leaked database can't be used to sign in.
9. A session stays valid for 90 days after it was last used; each authenticated request extends it. After 90 days unused it stops working.
10. Every API request that needs a signed-in person checks the token on the server and refuses a missing, unknown or expired one with a "not signed in" error.
11. Signing out ends the current session on the server immediately: its token stops working at once. Sessions on the person's other devices keep working.
12. Sign-in attempts are limited: after 5 failed attempts for the same email within 15 minutes, further attempts for that email are refused with a "too many attempts, try again later" error until the window passes. The same applies to 20 failed attempts from one IP address within 15 minutes.
12a. Sign-up attempts are limited too: after 10 sign-up attempts with valid input from one IP address within 15 minutes, further attempts from that IP are refused with "too many attempts" until the window passes. Input that fails validation doesn't count. (Added at Review to stop unlimited password hashing and unthrottled "email in use" lookups.)
12b. The client IP used by the limits comes from the connection unless the API is configured to trust a known number of proxy hops, so a client can't change its IP by sending an `X-Forwarded-For` header. (Added at Review.)
13. API errors use one JSON shape, `{ "error": { "code": "<stable code>", "message": "<human text>" } }`, with conventional HTTP status codes, and never include stack traces, query text or other internals. Later features reuse this shape.
14. An authenticated endpoint returns the signed-in person's own profile: id, email, display name and language choice. It never returns the password hash or session data.

### On the phone

15. On launch, if a session token is stored on the phone, the app opens signed in without asking for the password again; otherwise it shows the sign-in screen, which links to sign-up.
16. The session token is stored only in the phone's secure storage (iOS Keychain), never in plain storage.
17. If the server refuses the stored token as not signed in (expired or signed out elsewhere), the app removes it and returns to the sign-in screen.
18. If the phone is offline at launch with a stored token, the app stays signed in; it doesn't sign the person out because the server couldn't be reached.
19. Sign-in and sign-up forms show a clear message for each failure (invalid input, email in use, wrong email or password, too many attempts, no connection, server error), keep what the person typed except the password, and can't be submitted twice while a request is in flight.
20. A signed-in person can sign out from a Settings screen; the app removes the stored token and shows the sign-in screen, even if the server can't be reached at that moment.
21. Screens follow Decision 10: compact vertical flows, no tables.

### Language

22. Every screen in this feature is available in Vietnamese and English, with no hard-coded user-facing text.
23. Until the person chooses a language, the app follows the phone's language: Vietnamese if the phone's preferred language is Vietnamese, otherwise English. This includes the screens shown before sign-in.
24. A signed-in person can choose Vietnamese or English in Settings. The choice applies immediately and is saved on their account, so it also applies on their other devices after sign-in and is available to the server for later push notifications.
25. An account that has never chosen a language has no saved choice (it follows the phone), rather than a value copied from the phone at sign-up.
26. After signing in, a saved account choice takes precedence over the phone's language.

### Data

27. The first database schema and migration create what this feature needs (people and sessions) and apply cleanly to an empty PostgreSQL database.
28. The API reads its database connection string from the environment; the repository documents the required variables in an example env file with no real secrets.

## Acceptance Criteria

Automated tests cover the API requirements; the project currently has no test command, so adding one is part of this work. The phone-only checks that can't be automated go in the Test Handoff.

- **R1–R4:** API tests: sign-up with valid input succeeds; each invalid field (bad email, 7- and 129-character passwords, empty or 51-character name, whitespace-only name) is refused with a validation error naming the field; `"  Ana@Example.COM "` is stored as `ana@example.com`; the stored password value is not the password and verifies only with it; no log line contains the password.
- **R5:** API test: a second sign-up for the same email in different case is refused with the "email in use" code; two simultaneous sign-ups for one email produce exactly one account.
- **R6–R8:** API tests: sign-up and sign-in return a token that works on the profile endpoint; the stored session value differs from the token; a wrong password and an unknown email return the same status, code and message.
- **R9:** API test with a controllable clock: a token unused for 90 days plus a moment is refused; a token used on day 89 still works on day 178.
- **R10:** API tests: the profile endpoint with no token, a random token and an expired token each returns "not signed in".
- **R11:** API test: after sign-out, that token is refused; a second session for the same person still works.
- **R12:** API tests: the 6th failed attempt for one email within 15 minutes is refused with "too many attempts" even with the right password; it succeeds after the window; the IP limit triggers at the 21st failure across different emails.
- **R12a–R12b:** API tests: the 11th valid sign-up from one IP within 15 minutes gets `429`, invalid bodies don't count; with no trusted proxy, a spoofed `X-Forwarded-For` doesn't change the bucket; parallel wrong-password sign-ins can't exceed the R12 limit.
- **R13:** API tests: every error case above matches the error shape; an unexpected server error returns a generic message with no stack trace.
- **R14:** API test: the profile response contains exactly id, email, display name and language choice.
- **R15–R20:** Test Handoff on an iPhone with Expo Go: sign up, kill and reopen the app (still signed in), sign out (back to sign-in), sign in again; revoke the session from another device or by sign-out elsewhere, then reopen (back to sign-in); turn on Airplane mode and reopen (still signed in); trigger each error message; double-tap submit sends one request. Code review confirms the token is written only to secure storage.
- **R21:** Review against Decision 10 and `DESIGN.md` if one exists by then.
- **R22–R26:** Test Handoff: with the phone set to Vietnamese, sign-in and sign-up show Vietnamese; with French, they show English; a new account shows no saved language in the profile; choosing English in Settings switches immediately and the profile shows `en`; signing in on a second phone set to Vietnamese shows English. Lint or a test confirms no user-facing string is outside the translation files.
- **R27–R28:** Applying the migration to an empty Neon or local PostgreSQL database succeeds; the example env file lists `DATABASE_URL` and any new variables with placeholder values; no `.env` is committed.

## Out of Scope

- Forgot-password and password reset (deferred, Decision 1).
- Sign in with Google, Sign in with Apple or any other provider (deferred). Google sign-in is planned for later, so Plan should choose a data design that lets another sign-in method attach to an existing account without reworking accounts. Publishing to the App Store with Google sign-in will also require Sign in with Apple.
- Email verification and any email sending. They are deferred together with forgot-password, which needs the same email-sending service; Google sign-in will also give verified emails.
- Changing email, password or display name after sign-up, and deleting an account.
- Signing out of all devices, and a list of active sessions.
- Projects and everything that depends on them (#4 onward).
- Deploying the API to Render (#3); this feature runs against a local or Neon development database.
- Offline queuing of writes (#4); this feature only avoids signing someone out while offline.
- Push notifications and push tokens (#10, #16).
- Visual design direction beyond Decision 10; `/ourkit-design` can be run separately.

Known trade-offs recorded at Review: a session's last-used time is refreshed at most once an hour, so it can expire up to an hour before "90 days after last use" (R9); expired session rows aren't cleaned up yet; the per-email limit lets someone lock a user out for 15 minutes; the development API runs over plain HTTP on the LAN, and #3 must use HTTPS and set the exact proxy hop count.

## Open Questions

None. Decisions settled in this Stage: server-side sessions over JWT; sign-up asks for a display name; language follows the phone until the person chooses, then is saved on the account (user's answers). Settled by the agent, to confirm at spec review: revealing "email already in use" at sign-up (R5) for usability in a small friends' app, accepting that it shows whether an email has an account; no email verification (R6); the rate-limit numbers in R12, kept in memory because the API runs as a single instance on Render's free tier.
