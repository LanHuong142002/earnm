# Plan: The API runs on Render and stays awake

Spec: `.ourkit/specs/claude-ourkit-spec-3-cba408.md` (#3). Tier: Feature. Sensitive Areas: auth, public API, data.

## Approach

Add a small `/internal` router to the existing Express app, guarded by a middleware that checks `Authorization: Bearer <INTERNAL_SECRET>` in constant time. Move the environment checks out of `index.ts` into a pure `loadConfig(env)` function so the startup rules (R1) are unit-testable, and have it require `INTERNAL_SECRET` of at least 32 characters. Describe the production service in a root `render.yaml` Blueprint that builds the API and runs `prisma migrate deploy` before starting it. Add two small TypeScript scripts, run with the `tsx` already in devDependencies, for the Stack Profile's `deploy` (POST to the Render deploy hook) and `smoke` (check a deployed URL) commands; the smoke logic lives in `src/` so Vitest can test it against a local server. Write `docs/deploy.md` for the steps only the user can do. No new dependencies.

`internalSecret` is optional in `AppDeps`: when it's absent the internal endpoints refuse every request with `401`. That keeps every existing `createApp` call in tests unchanged (R6), while `index.ts` always passes it because `loadConfig` requires it.

## Prior Art

- **Bearer parsing:** `src/auth/require-auth.ts` has a private `parseBearer` (`/^bearer (\S+)$/i`, length cap). The internal guard uses the same header shape; I'll write a small separate parser in the internal module rather than export and couple the session one, since the internal secret has different length rules and a different error code (`unauthorized` vs `not_signed_in`).
- **Constant-time compare:** `src/auth/password.ts` uses `node:crypto` `timingSafeEqual`. Reuse it, comparing SHA-256 digests of the submitted and expected secret so the comparison is constant-time even when lengths differ (plain `timingSafeEqual` throws on unequal lengths and leaks length).
- **Errors:** reuse `AppError` and `errorHandler` from `src/http/errors.ts`, so the 401 uses the existing `{error:{code,message}}` format, and `expectError` from `src/test/helpers.ts` in tests.
- **Trust proxy:** `createApp` already sets `trust proxy` from `deps.trustProxy`; `/internal/ip` just returns `req.ip`. `src/auth/routes.test.ts` already builds apps with a given `trustProxy`, a pattern the IP test copies.
- **Config checks:** `src/index.ts` already validates `DATABASE_URL` and `TRUST_PROXY` inline; that logic moves into `loadConfig` with the same messages.
- **Migrations:** `package.json` already has `db:deploy` (`prisma migrate deploy`). The start step reuses it.
- **Render Blueprint, cron-job.org, Neon:** these are the official tools the ticket names; nothing in the project replaces them. Render's free plan has no pre-deploy command, so migrations run at the start of the start command (decided with the user in Spec).
- **Smoke/deploy scripts:** Node 24's built-in `fetch` covers both; no HTTP client is needed.

Conclusion: reuse the error format, crypto primitive, trust-proxy setup and `db:deploy` script; write new only the internal router, the config loader, the two scripts, the Blueprint and the docs.

## Changes

- `apps/api/src/config.ts` (new): `loadConfig(env): Config` returning `{ databaseUrl, trustProxy, internalSecret, port }`, or throwing a `ConfigError` whose message names the bad variable and never contains its value. `INTERNAL_SECRET` required, length ≥ 32 (R1).
- `apps/api/src/index.ts`: call `loadConfig(process.env)`; on `ConfigError` print its message and exit 1; pass `internalSecret` to `createApp`; keep listening on `PORT` (R11).
- `apps/api/src/internal/routes.ts` (new): `requireInternalSecret(secret?)` middleware (parse `Bearer`, SHA-256 both sides, `timingSafeEqual`; on any failure `AppError(401, "unauthorized", "Not authorized.")`; never logs the header) and `createInternalRouter({ internalSecret })` with `POST /tick` → `{status:"ok"}` (no database access) and `GET /ip` → `{ip: req.ip}` (R2–R5).
- `apps/api/src/app.ts`: add optional `internalSecret` to `AppDeps`; mount `app.use("/internal", createInternalRouter(deps))` before the not-found handler (R6: other routes untouched).
- `apps/api/src/ops/smoke.ts` (new): `runSmoke({ baseUrl, secret?, fetch })` returning a list of named check results — `GET /health` is 200; `POST /internal/tick` without a secret is 401; with `secret`, the tick is 200. Messages name the check and status, never the secret (R13).
- `apps/api/scripts/smoke.ts` (new): reads `API_BASE_URL` (required) and optional `INTERNAL_SECRET`, runs `runSmoke`, prints each result, exits non-zero on any failure or a missing `API_BASE_URL`.
- `apps/api/scripts/deploy-hook.ts` (new): reads `RENDER_DEPLOY_HOOK_URL`; if unset, prints a message naming it and exits 1; otherwise POSTs to it and reports success or the HTTP status, without printing the URL (it contains a key) (R12).
- `apps/api/package.json`: scripts `smoke` (`tsx scripts/smoke.ts`) and `deploy:hook` (`tsx scripts/deploy-hook.ts`); `engines.node` set to `>=24 <25`.
- `apps/api/tsconfig.json`: include `scripts` so they type-check; the build config is untouched, so scripts stay out of `dist`.
- `render.yaml` (new, repo root): one `web` service, `runtime: node`, `plan: free`, `region: singapore`, `rootDir: apps/api`, `branch: main`, `autoDeploy: true`, `buildCommand: npm ci --include=dev && npm run build`, `startCommand: npm run db:deploy && npm start`, `healthCheckPath: /health`; `envVars`: `NODE_VERSION` = `24`, and `DATABASE_URL`, `INTERNAL_SECRET`, `TRUST_PROXY` with `sync: false` (entered in the dashboard, no values in the repo); no `PORT` (R7–R9, R11).
- `.ourkit/stack-profile.json`: `"deploy": "npm --prefix apps/api run deploy:hook"`, `"smoke": "npm --prefix apps/api run smoke"` (R12, R13).
- `docs/deploy.md` (new): the steps from R14, in order, including using Neon's direct (non-pooled) connection string, `openssl rand -hex 32` (or a Node one-liner) for the secret, the cron-job.org job settings, the `TRUST_PROXY` check with `/internal/ip`, the `https://` `EXPO_PUBLIC_API_URL`, the smoke command, secret rotation, and how to see that a failed start keeps the previous deploy live (R10, R14).
- `apps/api/.env.example`: add `INTERNAL_SECRET` placeholder with how to generate it; point the `TRUST_PROXY` note at `docs/deploy.md`. `apps/mobile/.env.example`: note that production uses the `https://…onrender.com` URL (R15).
- At the end of Build: `ourkit pending add` for each user step — Neon production project, Render service from the Blueprint with its variables, cron-job.org job, setting `TRUST_PROXY` after checking `/internal/ip`, and the production `EXPO_PUBLIC_API_URL` (R16).

## Risks

- **Sensitive Area: auth.** A flawed secret check would open the internal endpoints. Mitigation: digest-then-`timingSafeEqual`, one code path for every failure, tests for each malformed-header case, and the Sensitive Reviewer at Review. Today the endpoints only answer, so a leak's impact is small, but #10 will give the tick real work.
- **Sensitive Area: public API.** Two new routes; existing routes must not change. Mitigation: mount under `/internal` before the not-found handler and keep the whole existing suite green unchanged.
- **Sensitive Area: data.** Migrations now run against a production database on every deploy. Mitigation: `prisma migrate deploy` only applies committed migrations; a failure stops the start, so Render keeps the previous version serving. The docs use a separate Neon project so development and tests can never touch production data.
- **Neon pooler and migrations.** `prisma migrate deploy` can misbehave through a PgBouncer pooled connection. Mitigation: the docs tell the user to use Neon's direct connection string; one free instance with light traffic doesn't need pooling.
- **Dev dependencies on Render.** If `NODE_ENV=production` is set, `npm ci` would skip `prisma` and `typescript`. Mitigation: `--include=dev` in the build command.
- **`render.yaml` can't be validated locally.** There is no Render CLI in the project. Mitigation: keep it to documented fields, review it against Render's Blueprint reference in Review, and confirm on the first deploy (Test Handoff).
- **Wrong `TRUST_PROXY`.** Too low makes everyone share one IP for rate limits; too high lets clients spoof IPs (Lesson: don't trust `X-Forwarded-For` by default). Mitigation: keep the default `0`, add `/internal/ip`, and make the check a documented, pending user step rather than guessing a hop count.
- **Secrets in the deploy hook URL.** The hook URL contains a key. Mitigation: the script reads it from the environment and never prints it.
- **Review convergence (Lesson).** Agreed up front: Review fixes blocking findings; non-blocking findings are fixed only when trivial and inside this change's files, otherwise listed in the Change Report.

## Test Strategy

Tests run through `ourkit gate run test` (`npm --prefix apps/api test`, Vitest against `TEST_DATABASE_URL`). New behaviour is written test-first.

- **R1:** `src/config.test.ts` — `loadConfig` with `INTERNAL_SECRET` missing and 31 characters throws a `ConfigError` naming the variable and not containing the value; 32 characters passes; existing `DATABASE_URL` and `TRUST_PROXY` rules still hold.
- **R2:** `src/internal/routes.test.ts` — the right bearer secret on `POST /internal/tick` gives `200 {"status":"ok"}`; the same test on an app built with a Prisma stand-in whose every property access throws proves no database call.
- **R3:** same file — with `trustProxy: 1` and `X-Forwarded-For: 203.0.113.7`, `GET /internal/ip` returns that address; with `trustProxy: 0` it returns the socket address.
- **R4:** same file — no header, non-Bearer scheme, empty value, wrong secret of the same length, wrong secret of a different length, and an app with no `internalSecret` all give `401 unauthorized` via `expectError`, on both endpoints. Constant-time comparison is checked by the reviewer.
- **R5:** the 401 body doesn't contain the submitted value; `console.error` and `console.log` spies see no secret during the failure cases; a reviewer checks for logging paths and `git grep` for committed secrets.
- **R6:** the existing suite passes with no edits to existing test files.
- **R12, R13:** `src/ops/smoke.test.ts` runs `runSmoke` against the test app listening on a random local port — passes with the right secret, fails on the secret check with a different secret (and its output contains neither secret), and fails on `/health` against a closed port. The deploy-hook script's missing-variable path is run by hand in Review.
- **R7–R9, R11:** reviewer reads `render.yaml`; `ourkit gate run build` passes; locally, `npm run db:deploy && npm start` against the development database starts the server.
- **R14–R16:** reviewer follows the docs and `.env.example` files; `ourkit pending` lists the user's steps.
- **Test Handoff (can't be automated, needs the user's accounts):** first deploy from the Blueprint; a failed start keeps the previous deploy live; Neon production project in Singapore and separate from development; cron-job.org shows `200` every 5 minutes; after 30 minutes with no other traffic `GET /health` answers in under 2 seconds with no sleep restart in Render's logs; `TRUST_PROXY` set so `/internal/ip` from a phone shows its network's public IP; the iPhone app signs in over the `https://` URL; the `smoke` and `deploy` commands run against production by the user.
