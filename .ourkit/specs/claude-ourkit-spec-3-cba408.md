# Spec: The API runs on Render and stays awake

Ticket: #3 (Epic F2). Tier: Feature. Sensitive Areas: auth, public API, data.

## Goal

The earnm API runs in production on Render's free tier, in Singapore, against its own Neon production database, and a phone anywhere can reach it over `https://`. An outside cron on cron-job.org calls a secret-protected `POST /internal/tick` every 5 minutes, so the service never hits Render's 15-minute idle sleep and the app never waits for a cold start. The same endpoint later drives reminder delivery (#10); this Feature only makes it exist and keeps the server awake.

It also closes the two deployment notes left by #2: the app must talk to the API over HTTPS, and `TRUST_PROXY` must match Render's proxy so the sign-in rate limits see each person's real IP instead of one shared IP.

Today the API runs only on a developer's PC (`npm run dev`), reads `DATABASE_URL`, `PORT` and `TRUST_PROXY` from `apps/api/.env`, has no internal endpoints, and the Stack Profile declares no `deploy` or `smoke` command. Creating the Render, Neon and cron-job.org accounts and pasting secrets into them are steps only the user can do.

## Requirements

### Internal endpoints

1. The API reads a shared secret, `INTERNAL_SECRET`, from the environment. The server refuses to start, with a clear message that names the variable but never prints its value, when it is missing or shorter than 32 characters.
2. `POST /internal/tick` with the header `Authorization: Bearer <INTERNAL_SECRET>` answers `200` with `{"status":"ok"}`. In this Feature it does nothing else: it does not query the database, so it doesn't keep Neon awake.
3. `GET /internal/ip` with the same header answers `200` with `{"ip":"<address>"}`, the client IP the server sees after applying `TRUST_PROXY`. It exists so the user can check that `TRUST_PROXY` is right after deploying.
4. A request to either internal endpoint with a missing, malformed or wrong `Authorization` header gets `401` with the existing error format, `{"error":{"code":"unauthorized","message":"Not authorized."}}`, and nothing else happens. The secret comparison takes the same time however much of the secret matches.
5. The secret never appears in a response, a log line or an error message, and is never committed to the repository.
6. Existing endpoints (`/health`, `/auth/*`, `/me`) behave exactly as before.

### Production deploy

7. The repository contains a Render Blueprint (`render.yaml`) describing one free web service in the Singapore region, rooted at `apps/api`, that deploys automatically on each push to `main` and uses `GET /health` as its health check.
8. Its build installs dependencies, generates the Prisma client and compiles the API. Its start step applies pending database migrations (`prisma migrate deploy`) and then starts the server. If migrations fail, the new version doesn't start and Render keeps the previous version serving.
9. The Blueprint declares every environment variable the service needs (`DATABASE_URL`, `INTERNAL_SECRET`, `TRUST_PROXY`, and the Node version) without any secret value: secret values are entered by the user in Render's dashboard.
10. The production database is a separate Neon project in the Singapore region, never the development or test database.
11. The server listens on the `PORT` Render provides.

### Commands and documentation

12. The Stack Profile declares a `deploy` command that triggers a Render deploy through the deploy hook URL read from the environment (`RENDER_DEPLOY_HOOK_URL`), and fails with a clear message when that variable is unset. Because Render is production, only the user runs it (ADR 0010).
13. The Stack Profile declares a `smoke` command that checks a deployed API at the base URL from the environment (`API_BASE_URL`): `GET /health` returns `200`, and `POST /internal/tick` without a secret returns `401`. When `INTERNAL_SECRET` is also set, it checks that the tick with the secret returns `200`. It exits non-zero on any failure, says which check failed, and never prints the secret.
14. `docs/deploy.md` gives the steps, in order, for someone who has never deployed this project: create the Neon production project; create the Render service from the Blueprint and enter the environment variables; generate a strong `INTERNAL_SECRET`; set up the cron-job.org job (`POST` every 5 minutes with the `Authorization` header, with failure notifications on); find the right `TRUST_PROXY` with `GET /internal/ip`; point the app at the `https://…onrender.com` URL through `EXPO_PUBLIC_API_URL`; run the smoke command; and rotate `INTERNAL_SECRET` (change it in Render and in cron-job.org).
15. `apps/api/.env.example` lists `INTERNAL_SECRET` with a placeholder and a note on how to generate one, and its `TRUST_PROXY` note points to `docs/deploy.md`. `apps/mobile/.env.example` notes that production uses the `https://` Render URL.
16. The steps only the user can do (accounts, secrets, cron job, setting `TRUST_PROXY`) are recorded with `ourkit pending add` so they aren't forgotten.

## Acceptance Criteria

1. R1: Automated tests start the app's configuration check with `INTERNAL_SECRET` unset and with a 31-character value, and see it refuse with a message naming the variable and not containing the value; a 32-character value is accepted.
2. R2: An automated test calls `POST /internal/tick` with the right bearer secret and gets `200 {"status":"ok"}`, and the test shows no database query was made (for example, it passes with a database client that fails on any call).
3. R3: An automated test with the app's `trustProxy` set to 1 sends `X-Forwarded-For: 203.0.113.7` to `GET /internal/ip` with the secret and gets `{"ip":"203.0.113.7"}`; with `trustProxy` 0 it gets the socket address instead.
4. R4: Automated tests call each internal endpoint with no header, a non-Bearer header, an empty bearer value, a wrong secret of the same length and a wrong secret of a different length, and each gets `401` with code `unauthorized`. A reviewer confirms the comparison uses a constant-time function.
5. R5: A reviewer finds no code path that logs or returns the secret; `git grep` finds no secret value in the repository; the 401 response body never contains the submitted header.
6. R6: The existing test suite passes unchanged through `ourkit gate run test`.
7. R7–R9, R11: A reviewer reads `render.yaml` and confirms plan free, region singapore, `rootDir: apps/api`, auto-deploy on `main`, health check `/health`, the build and start steps from R8, every variable from R9 marked to be entered in the dashboard with no value, and no `PORT` override. `npm --prefix apps/api run build` passes, and the start step run locally against the development database applies migrations and starts the server.
8. R8 (failure): By hand, after the first deploy: the Test Handoff tells the user how to confirm in Render that a failed start leaves the previous deploy live (Render's documented behaviour for a failed health check).
9. R10: By hand: the Neon production project is in Singapore and its connection string differs from the ones in `apps/api/.env`.
10. R12: Running the `deploy` command with `RENDER_DEPLOY_HOOK_URL` unset exits non-zero with a message naming the variable; with it set, the user sees a new deploy start in Render.
11. R13: Running the `smoke` command against a local server passes; against a local server started with a different secret, the secret check fails and the output doesn't contain either secret; against a URL that isn't running, it fails on `/health`.
12. Staying awake (Goal): By hand: after the cron job has run for at least 30 minutes with no other traffic, `GET /health` on the Render URL answers in under 2 seconds, and Render's logs show no restart from sleeping in that time; cron-job.org's history shows `200` responses every 5 minutes.
13. HTTPS and real IP (Goal): By hand: the app on an iPhone signs in against the `https://` Render URL, and `GET /internal/ip` called from the phone's network returns that network's public IP once `TRUST_PROXY` is set as `docs/deploy.md` describes.
14. R14–R16: A reviewer follows `docs/deploy.md` and the `.env.example` files and finds every step from R14 present and in an order that works; `ourkit pending` lists the user's steps.

## Out of Scope

- What the tick does for reminders, such as sending missed pushes (#10). The tick here only answers.
- Keeping the Neon database awake: its free compute allowance can't cover 24/7, and it wakes on the next real query.
- Rate limiting the internal endpoints: a 32-character random secret can't be guessed by repeated tries, and the auth rate limits from #2 are unchanged.
- A staging environment, custom domain, CDN, or paid Render or Neon plans.
- Monitoring and alerting beyond cron-job.org's own failure notifications.
- Building and distributing the iOS app (EAS builds, TestFlight); this Feature only documents the URL the app should use.
- Making the mobile app refuse a non-`https` URL; it stays a documented setting.
- Automatic database backups beyond what Neon's free plan already keeps.
- The agent running the production deploy: Render is production, so the user runs it (ADR 0010).

## Open Questions

None.
