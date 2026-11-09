# Tasks: People can create an account and sign in on iPhone

Spec: `.ourkit/specs/claude-ourkit-spec-2-479e1e.md`. Plan: `.ourkit/plans/claude-ourkit-spec-2-479e1e.md`. Read both before starting any task.

API tests need `TEST_DATABASE_URL` in `apps/api/.env`, pointing to a separate empty local PostgreSQL database. Until the user has set it up, `ourkit gate run test` reports `not-run`. Report that as not run, never as passed, and never point tests at `DATABASE_URL`.

## Tasks

### 1. API foundation: schema, migration, app factory, errors, test setup

In `apps/api`:

- Add the dependencies `zod` and `@prisma/adapter-pg`, and the dev dependencies `vitest`, `supertest` and `@types/supertest`.
- Add the scripts `test` (`vitest run`), `db:migrate` (`prisma migrate dev --config prisma7.config.ts`) and `db:deploy` (`prisma migrate deploy --config prisma7.config.ts`).
- In `prisma/schema.prisma`, add `enum Language { vi en }` and the `User` and `Session` models exactly as in the plan's Changes section.
- Generate the client, and create the first migration named `auth` with `npm run db:migrate -- --name auth`. It runs against `DATABASE_URL` from `apps/api/.env`, which is a Neon development database. Commit the generated `prisma/migrations` folder.
- Add `src/db.ts`, which creates a `PrismaClient` with the `pg` adapter from a connection string argument.
- Add `src/app.ts` exporting `createApp({ prisma, now })`. It sets `trust proxy` to 1, uses `express.json({ limit: "10kb" })`, keeps `GET /health`, and adds a 404 handler (`404 not_found`) and the error middleware.
- Change `src/index.ts` so it only builds the Prisma client from `DATABASE_URL`, calls `createApp({ prisma, now: () => new Date() })` and listens on `PORT` (default 3000).
- Add `src/http/errors.ts`:
  - An `AppError(status, code, message)` class.
  - Error middleware that returns `{ error: { code, message } }`.
  - `ZodError` becomes `400 validation_failed`, and the message names the failing fields.
  - A body-parser JSON syntax error becomes `400 invalid_json`.
  - Anything else becomes `500 internal_error` with a generic message, logging only the error's name and stack and never the request body.
- Add `.env.example` with `DATABASE_URL`, `TEST_DATABASE_URL` and `PORT` placeholders, with no real values.
- Add `vitest.config.ts` and a global setup:
  - It loads `apps/api/.env` and requires `TEST_DATABASE_URL`.
  - It throws, so the suite fails clearly, if that's missing or equal to `DATABASE_URL`.
  - It runs `prisma migrate deploy` against the test database.
- Export a test helper that creates the app with a test Prisma client and a controllable clock, and truncates `Session` and `User` before each test.
- Add tests:
  - `GET /health` returns 200.
  - An unknown route returns `404 not_found` in the error shape.
  - Malformed JSON returns `400 invalid_json`.
  - A route that throws returns `500 internal_error` with no stack in the body.
- In `.ourkit/stack-profile.json`, set `commands.test` to `npm --prefix apps/api test`.

Depends on: none
Verify: `ourkit gate run build` passes. `ourkit gate run test` passes, or reports not-run only because `TEST_DATABASE_URL` isn't set yet. The migration SQL creates `User`, `Session`, the unique indexes on `email` and `tokenHash`, and the cascading foreign key. `git check-ignore apps/api/.env` succeeds.

### 2. Password hashing

Add `apps/api/src/auth/password.ts`:

- `hashPassword(plain)` uses `crypto.scrypt` with a 16-byte random salt. It stores the algorithm, its parameters, the salt and the hash in one string.
- `verifyPassword(plain, stored)` recomputes the hash and compares with `crypto.timingSafeEqual`. It returns false, without throwing, for a malformed stored value.
- `dummyVerify(plain)` does the same amount of work against a fixed hash, so an unknown email takes about as long as a wrong password.

Add unit tests: hashing and verifying round-trip; a wrong password fails; the stored value doesn't contain the password; two hashes of the same password differ; a tampered or malformed stored value returns false.

Depends on: 1
Verify: `ourkit gate run test` passes, or reports not-run only because `TEST_DATABASE_URL` isn't set. These are pure unit tests and also pass with `npx vitest run src/auth/password.test.ts` when the global setup allows it. `ourkit gate run build` passes.

### 3. Failed sign-in limiter

Add `apps/api/src/auth/rate-limit.ts`, exporting a factory `createSignInLimiter({ now })` with three functions:

- `isBlocked({ email, ip })` returns true when the email has 5 or more failures, or the IP has 20 or more failures, inside the last 15 minutes.
- `recordFailure({ email, ip })` records a failure.
- Entries older than 15 minutes are dropped as they're read.

The limiter keeps its state in memory and has no timers.

Add unit tests using a fake clock:
- After 5 failures for an email, it's blocked; at 15 minutes after the first failure, it's free again.
- 20 failures from one IP across different emails block that IP.
- One email's failures don't block another email from a different IP.

Depends on: 1
Verify: `ourkit gate run test` passes, or reports not-run only because `TEST_DATABASE_URL` isn't set. `ourkit gate run build` passes.

### 4. Sessions and the auth middleware

Add `apps/api/src/auth/sessions.ts`:

- `createSession(prisma, userId, now)` generates `crypto.randomBytes(32)` encoded base64url. It stores `sha256(token)` as `tokenHash` with `lastUsedAt = now`, and returns the token.
- `resolveSession(prisma, token, now)` finds the session by hash. It returns null if there's none, or if `lastUsedAt + 90 days <= now`. Otherwise, it updates `lastUsedAt` when that's more than one hour old, and returns the session with its `userId`.
- `revokeSession(prisma, sessionId)` deletes the session.

Add `apps/api/src/auth/require-auth.ts`. It's middleware that reads `Authorization: Bearer <token>`, resolves the session with the app's `now`, and attaches `userId` and `sessionId` to the request. A missing, unknown or expired token gets `AppError(401, "not_signed_in")`.

Add tests against the test database:
- The stored `tokenHash` is not the token.
- A token resolves.
- A token unused for exactly 90 days is rejected.
- A token used on day 89 still resolves on day 178.
- A revoked token is rejected.
- The middleware returns `401 not_signed_in` in the error shape for no header, a random token and an expired token.

Depends on: 1
Verify: `ourkit gate run test` passes. `ourkit gate run build` passes.

### 5. Sign-up, sign-in and sign-out routes

Add `apps/api/src/auth/routes.ts`, mounted at `/auth` by `createApp`, with one sign-in limiter instance per app.

- **`POST /auth/sign-up`** takes `{ email, password, displayName }`, validated with `zod`:
  - The email is trimmed, lowercased, valid and at most 254 characters.
  - The password is 8 to 128 characters.
  - The display name is trimmed and 1 to 50 characters.
  - It creates the user with `hashPassword`, then a session, and returns `201 { token, user }`, where `user` is `{ id, email, displayName, language }`.
  - A Prisma `P2002` error on `email` becomes `409 email_in_use`.
- **`POST /auth/sign-in`** takes `{ email, password }`:
  - The email is normalised the same way. The IP is `req.ip`.
  - If the limiter blocks, it returns `429 too_many_attempts` without checking the password.
  - An unknown email (after `dummyVerify`) or a wrong password gives `401 invalid_credentials` with an identical message, and records a failure.
  - On success, it returns `200 { token, user }`.
- **`POST /auth/sign-out`** uses `requireAuth`, revokes the current session, and returns `204`.

Never log the request body or the password.

Add tests:
- Spec R1–R8, R11 and R12, as listed in the plan's Test Strategy. These include:
  - Validation errors naming each bad field.
  - Email normalisation.
  - A duplicate in another case gives `409`.
  - Two parallel sign-ups for one email produce exactly one user.
  - Unknown email and wrong password responses are identical.
  - The 6th failure for an email gets `429` even with the right password, and works again after 15 minutes on the fake clock.
  - The 21st failure from one `X-Forwarded-For` IP across emails gets `429`.
  - After sign-out, that token is refused while a second session still works.
- A spy on `console` shows the password never appears in any log output.

Depends on: 2, 3, 4
Verify: `ourkit gate run test` passes. `ourkit gate run build` passes.

### 6. Profile endpoints

Add `apps/api/src/me/routes.ts`, mounted at `/me` and using `requireAuth`:

- `GET /me` returns exactly `{ id, email, displayName, language }`.
- `PATCH /me` accepts `{ language: "vi" | "en" }`, validated with `zod`, saves it and returns the updated profile. Any other value or field is `400 validation_failed`.

Add tests:
- A new user's `language` is `null`.
- `GET /me` has exactly those four keys, with no `passwordHash` or session data.
- `PATCH` saves `en`, and a later `GET` returns it.
- An invalid language is rejected.
- Both routes return `401` without a token.

Create test users and sessions directly with `hashPassword` and `createSession`.

Depends on: 2, 4
Verify: `ourkit gate run test` passes. `ourkit gate run build` passes.

### 7. Mobile foundation: i18n, API client, token storage

In `apps/mobile`:

- Run `npx expo install expo-secure-store expo-localization`, then install `i18next` and `react-i18next`, plus the dev dependency `eslint-plugin-i18next`.
- In `eslint.config.js`, enable `i18next/no-literal-string` for JSX text in `src/`, ignoring style props and test files.
- Add `.env.example` with `EXPO_PUBLIC_API_URL=http://192.168.x.x:3000` and a comment that it must be the PC's LAN address.
- Add the translation setup:
  - `src/i18n/index.ts` initialises i18next with `src/i18n/vi.json` and `src/i18n/en.json`.
  - It exports `resolveLanguage(accountChoice)`. That returns the choice if it isn't null; otherwise `vi` if `getLocales()[0].languageCode` is `vi`; otherwise `en`.
  - It also exports `applyLanguage(lang)`.
  - Fill both JSON files with every string the screens in task 8 need: titles, labels, buttons, the language names, and one message for each error code (`validation_failed`, `email_in_use`, `invalid_credentials`, `too_many_attempts`, `not_signed_in`, `network`, `internal_error`, and a generic fallback).
- Add `src/lib/api.ts`:
  - A `request(path, { method, body, token })` built on `fetch` and `EXPO_PUBLIC_API_URL`. It sends JSON and adds `Authorization: Bearer` when it has a token.
  - It returns the parsed body for a 2xx response.
  - For an error, it throws `ApiError(code, status)` from the `{ error: { code } }` shape, falling back to `internal_error`. A `fetch` rejection throws `ApiError("network")`.
  - Add typed helpers: `signUp`, `signIn`, `signOut`, `getMe` and `updateLanguage`.
- Add `src/auth/token-store.ts`, with get, save and delete for the session token and for the last known language choice, through `expo-secure-store` only.

Depends on: none
Verify: `ourkit gate run lint` passes. `npx tsc --noEmit` in `apps/mobile` has no errors in these files.

### 8. Mobile auth flow and screens

In `apps/mobile`:

- Add `src/auth/AuthProvider.tsx`, a React context exposing `status` (`loading`, `signedIn` or `signedOut`), `user`, `signIn`, `signUp`, `signOut` and `setLanguage`.
  - **On mount:** read the stored token and language choice, and apply `resolveLanguage(storedChoice)`. With a token, set `signedIn` at once, then call `getMe` in the background. On success, store and apply the account language. On `not_signed_in`, delete the token and set `signedOut`. On `network`, stay signed in. Without a token, set `signedOut`.
  - **`signIn` and `signUp`:** store the token and apply the returned user's language.
  - **`signOut`:** call the API, ignoring any error, then delete the token and set `signedOut`.
  - **`setLanguage`:** apply the language right away, save it locally, then call `updateLanguage`.
- Change `src/app/_layout.tsx` to wrap the app in the i18n provider and `AuthProvider`. Show nothing while `loading`. Use `Stack.Protected` so the `(auth)` group shows when signed out and the `(app)` group when signed in.
- Add `src/app/(auth)/sign-in.tsx` and `src/app/(auth)/sign-up.tsx`:
  - Compact vertical forms: email, password, and display name on sign-up.
  - Inline translated error text for the `ApiError` code.
  - The submit button is disabled with a spinner while a request is in flight, so double taps send one request.
  - After a failure, keep the email and name and clear the password.
  - Each screen links to the other.
- Add `src/app/(app)/index.tsx`, a minimal signed-in home showing the display name and linking to Settings. Remove the old placeholder `src/app/index.tsx`.
- Add `src/app/(app)/settings.tsx`, with a VI/EN choice showing the current language and a sign-out button.
- Every visible string comes from `t()`. Use no tables.

Depends on: 7
Verify: `ourkit gate run lint` passes. `npx tsc --noEmit` in `apps/mobile` has no errors. The user checks the rest on an iPhone with Expo Go against the running API, as the Test Handoff for spec R15–R26: sign up; reopen, still signed in; sign out; sign in; signed out elsewhere, then reopen, back to sign-in; Airplane mode, then reopen, still signed in; each error message; double tap sends one request; phone set to Vietnamese or French before sign-in; choose English, and the choice applies on a second phone.

### 9. Apply DESIGN.md to the mobile screens

In `apps/mobile`, make the screens from task 8 follow `DESIGN.md` at the project root. Read the whole file first: its tokens, Density, Components, States, Motion and Avoid sections are the requirements.

- Run `npx expo install @expo-google-fonts/plus-jakarta-sans`. Load weights 400, 600 and 800 with `useFonts` in `src/app/_layout.tsx`, and keep the splash screen up until the fonts are ready, using `expo-splash-screen`, which is already installed.
- Add `src/theme/tokens.ts` with the light and dark colour sets, typography, spacing, layout, radius and motion values exactly as in `DESIGN.md`'s front matter. Add `src/theme/useTheme.ts`, which returns the set for `useColorScheme()`.
- Add small shared components in `src/ui/`, each built only from tokens:
  - `Screen`: safe area, `screenPadding`, content top-aligned, `background`.
  - `Button`: primary and secondary variants plus a danger text variant, with the loading spinner and press scale.
  - `TextField`: label, leading icon, focus border, error border and background.
  - `Card` and `ChoiceRow`: a selected row shows a ✓ icon, with `accessibilityRole="radio"`.
  - `ErrorText`: alert icon, with the shake and fade-in motion.
  - `PressableScale`.
- Use `@expo/vector-icons`, which ships with Expo, for outline icons. If it isn't installed, use `npx expo install @expo/vector-icons`.
- Add an entrance helper on `react-native-reanimated`: fade, rise 8px, stagger 40ms. Every motion checks `useReducedMotion()` and falls back to fade only.
- Rewrite `src/app/(auth)/sign-in.tsx`, `src/app/(auth)/sign-up.tsx`, `src/app/(app)/index.tsx` and `src/app/(app)/settings.tsx` on these components.
  - Keep all behaviour from task 8 unchanged.
  - Keep the screens small and uncluttered as the Density section says.
  - On sign-in and sign-up, use a 48×48 `tile` with a cup icon, the `screenTitle`, one line of `textSecondary`, the fields, and the primary button at the bottom.
  - Home shows the display name and a link to Settings; don't add any feature UI that doesn't exist yet.
  - Settings shows a language card with two `ChoiceRow`s and a secondary sign-out button in `danger`.
- Remove `src/auth/AuthForm.tsx`'s hard-coded styles, or replace the file with the new components. No hex colours or raw font sizes may remain in `src/app` or `src/auth`.
- Change the `expo-splash-screen` `backgroundColor` in `app.json` to `#FFFFFF`, and add `dark: { backgroundColor: "#121212" }` if the plugin supports it.
- Add any new strings to both `vi.json` and `en.json`.

Depends on: 8
Verify: `ourkit gate run lint` passes. `npx tsc --noEmit` in `apps/mobile` has no errors. Searching `src/app` and `src/auth` for `#[0-9a-fA-F]{3,6}` and `fontSize:` finds nothing. The user checks the look in the Test Handoff: light and dark mode on a small and a large iPhone; Vietnamese diacritics in Plus Jakarta Sans; entrance, press and error-shake motion; only fades with Reduce Motion on.
