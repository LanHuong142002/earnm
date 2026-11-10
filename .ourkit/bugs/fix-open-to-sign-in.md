# Bug: signed-out launch opens "Unmatched Route" instead of Sign in

## Symptom

Reported by the user while testing #3 on an iPhone with Expo Go: when signed out, opening the app shows Expo Router's not-found screen, and they must open the sitemap and tap sign-in or sign-up to continue. Expected: the splash screen, then Sign in when signed out, or the home screen when signed in.

## Reproduction

1. Ran the mobile app on the web (`npm --prefix apps/mobile run web -- --port 8091`) in a browser with no stored session.
2. Opened `http://localhost:8091/`.
3. Seen: the URL changed to `/(auth)` and the page showed "Unmatched Route. Page could not be found." with a Sitemap link.

The mobile app has no test runner, and adding one would mean new dependencies, so the reproduction is this manual run rather than an automated test.

## Root Cause

`apps/mobile/src/app/_layout.tsx`, `RootNavigator`: the `(app)` group is wrapped in `<Stack.Protected guard={status === "signedIn"}>`, and `/` only matches `(app)/index.tsx`. When the guard is false, Expo Router redirects to the stack's anchor or first available screen. That is the `(auth)` group, which has no index route, so `/(auth)` matches nothing.

## Fix

Added `redirectTo="/sign-in"` to the `(app)` `Stack.Protected` in `apps/mobile/src/app/_layout.tsx`, with a short comment explaining why. This is the SDK 58 documented way to send a denied protected route to a specific screen (docs.expo.dev/router/advanced/protected). Nothing else changed: no sign-in logic, token storage, splash handling or server check.

## Verification

- Web, signed out:
  - Opening `/` now lands on `/sign-in` and shows the Sign in screen.
  - Opening `/settings` also lands on `/sign-in`.
  - `/sign-up` still opens Create account.
  - No console errors.
- Sign-out, reported by the user on `main` after the first fix: signed in, open Settings, sign out, and the app showed Unmatched Route, including after going back. On the web, with a temporary switch that flipped the auth status (removed afterwards, not committed):
  - Without the fix: a signed-in launch reached `/`, then `/settings`. Signing out went to `/(auth)` and showed Unmatched Route, which reproduces the report.
  - With the fix, the same steps: signing out goes to `/sign-in`, going back stays on `/sign-in`, signing in again returns to `/`. Signing out from home also lands on `/sign-in`.
  - So the same root cause and the same fix cover both the launch and the sign-out.
- `ourkit gate run lint` passed.
- `npx tsc --noEmit` in `apps/mobile` passed.
- `ourkit gate run build` passed.
- `ourkit gate run test` passed (130 API tests). The API is unchanged; the mobile app has no tests.
- `ourkit gate floor` passed.
- Test Handoff (not checked here, because signing in on the web isn't supported by the secure token store):
  1. On an iPhone in Expo Go, signed out, open the app. Expected: splash, then Sign in, with no sitemap.
  2. Sign in. Expected: the home screen.
  3. Close and reopen the app. Expected: splash, then home.
  4. Sign out from Settings. Expected: Sign in.
