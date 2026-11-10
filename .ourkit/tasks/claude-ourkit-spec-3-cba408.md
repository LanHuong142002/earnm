# Tasks: The API runs on Render and stays awake

Spec: `.ourkit/specs/claude-ourkit-spec-3-cba408.md`. Plan: `.ourkit/plans/claude-ourkit-spec-3-cba408.md`. Read both before starting any task.

API tests need `TEST_DATABASE_URL` in `apps/api/.env`, pointing to a separate empty database. If it isn't set, `ourkit gate run test` reports `not-run`: report that as not run, never as passed, and never point tests at `DATABASE_URL`. Never print, log or commit a real secret. Add no dependencies.

## Tasks

### 1. Config loader with INTERNAL_SECRET

In `apps/api`, write `src/config.test.ts` first, then add `src/config.ts` exporting `class ConfigError extends Error` and `loadConfig(env: Record<string, string | undefined>): { databaseUrl: string; trustProxy: number; internalSecret: string; port: number }`.

- `DATABASE_URL` missing → `ConfigError("DATABASE_URL is not set.")`.
- `TRUST_PROXY` defaults to `"0"`; anything not matching `/^\d+$/` → `ConfigError("TRUST_PROXY must be a non-negative integer (the number of proxy hops).")`.
- `INTERNAL_SECRET` missing → a message naming `INTERNAL_SECRET` as not set; shorter than 32 characters → a message naming `INTERNAL_SECRET` and saying it must be at least 32 characters. Messages never contain the value.
- `PORT` defaults to 3000.

Then change `src/index.ts` to call `loadConfig(process.env)`, print the `ConfigError` message to stderr and exit 1 on failure, and use the returned values. Don't pass `internalSecret` to `createApp` yet (task 2 does that). `.env.example` is task 5. After this task, `npm run dev` needs `INTERNAL_SECRET` in `apps/api/.env`; mention that in the report, and don't edit the user's `.env`.

Tests: missing and 31-character secret throw `ConfigError` naming the variable and not containing the value; 32 characters passes; missing `DATABASE_URL` and a bad `TRUST_PROXY` still throw; defaults for `TRUST_PROXY` and `PORT`.

Depends on: none
Verify: `ourkit gate run test` passes including `src/config.test.ts`; `ourkit gate run build` passes.

### 2. Internal router: POST /internal/tick and GET /internal/ip

In `apps/api`, write `src/internal/routes.test.ts` first, then add `src/internal/routes.ts`:

- `requireInternalSecret(secret: string | undefined): RequestHandler`. Parse `Authorization` with `/^bearer (\S+)$/i`. If the secret is undefined, the header is missing or malformed, or the value doesn't match, call `next(new AppError(401, "unauthorized", "Not authorized."))` (from `src/http/errors.ts`). Compare by SHA-256 digesting both the submitted value and the secret and using `crypto.timingSafeEqual` on the digests. Never log the header or the secret.
- `createInternalRouter(deps: { internalSecret?: string }): Router` applying that guard, with `POST /tick` → `200 {"status":"ok"}` (no database access) and `GET /ip` → `200 {"ip": req.ip}`.

In `src/app.ts`, add optional `internalSecret?: string` to `AppDeps` and mount `app.use("/internal", createInternalRouter(...))` before `notFoundHandler`. Because the tsconfig uses `exactOptionalPropertyTypes`, pass the field only when defined. In `src/index.ts`, pass `internalSecret` from `loadConfig` to `createApp`.

Tests (use `createApp` with the test `prisma` from `src/test/helpers.ts`, a 32+ character test secret, and `expectError`):
- Right secret on tick → `200 {"status":"ok"}`; the same call on an app whose `prisma` is a `Proxy` that throws on any property access also returns 200 (no database use).
- `GET /internal/ip` with the secret: `trustProxy: 1` and `X-Forwarded-For: 203.0.113.7` → `{"ip":"203.0.113.7"}`; `trustProxy: 0` → not that address (the socket address).
- On both endpoints: no header, `Basic xyz`, `Bearer ` with empty value, wrong secret of the same length, wrong secret of a different length, and an app built without `internalSecret` → `401 unauthorized`; the response body doesn't contain the submitted value; `console.log`/`console.error` spies receive nothing containing the secret.
Don't edit any existing test file.

Depends on: 1
Verify: `ourkit gate run test` passes, with existing test files unchanged; `ourkit gate run build` passes.

### 3. Smoke and deploy-hook commands

In `apps/api`:

- Write `src/ops/smoke.test.ts` first, then add `src/ops/smoke.ts` exporting `runSmoke(opts: { baseUrl: string; secret?: string; fetch?: typeof fetch }): Promise<{ name: string; ok: boolean; detail: string }[]>`. Checks: `GET /health` is 200; `POST /internal/tick` with no `Authorization` is 401; when `secret` is given, `POST /internal/tick` with `Bearer <secret>` is 200. A network error marks that check failed. `detail` names the expected and actual status, never the secret.
- Add `scripts/smoke.ts`: reads `API_BASE_URL` (exit 1 with a message naming it if unset) and optional `INTERNAL_SECRET` (loading `.env` is not needed), strips a trailing `/`, runs `runSmoke`, prints one line per check, exits 1 if any failed.
- Add `scripts/deploy-hook.ts`: reads `RENDER_DEPLOY_HOOK_URL`; if unset, prints a message naming it and exits 1; otherwise `POST`s to it and prints success or the HTTP status, never the URL; exits 1 on failure.
- `package.json`: scripts `"smoke": "tsx scripts/smoke.ts"`, `"deploy:hook": "tsx scripts/deploy-hook.ts"`; add `"engines": { "node": ">=24 <25" }`.
- `tsconfig.json`: add `"scripts"` to `include` (leave `tsconfig.build.json` alone so scripts stay out of `dist`).
- `.ourkit/stack-profile.json` (repo root): add `"deploy": "npm --prefix apps/api run deploy:hook"` and `"smoke": "npm --prefix apps/api run smoke"`.

Tests: start the app from `createApp` (test `prisma`, a test secret) on port 0 with `app.listen`, then `runSmoke` passes all three checks with the right secret; with a different secret the tick-with-secret check fails and no `detail` contains either secret; against `http://127.0.0.1:<closed port>` the health check fails. Close the server after each test.

Depends on: 2
Verify: `ourkit gate run test` passes; `ourkit gate run build` passes; `npm --prefix apps/api run deploy:hook` with `RENDER_DEPLOY_HOOK_URL` unset exits non-zero naming the variable.

### 4. Render Blueprint

Add `render.yaml` at the repository root with one service: `type: web`, `name: earnm-api`, `runtime: node`, `plan: free`, `region: singapore`, `rootDir: apps/api`, `branch: main`, `autoDeploy: true`, `buildCommand: npm ci --include=dev && npm run build`, `startCommand: npm run db:deploy && npm start`, `healthCheckPath: /health`. `envVars`: `NODE_VERSION` with value `"24"`; `DATABASE_URL`, `INTERNAL_SECRET` and `TRUST_PROXY` each with `sync: false` and no value. No `PORT`. Add a short comment at the top pointing to `docs/deploy.md`. Check field names against Render's Blueprint specification.

Depends on: none
Verify: a reviewer confirms every field listed here against Render's Blueprint reference; `git grep` finds no secret value in it. The first real deploy is part of the Test Handoff (user only).

### 5. Deployment docs and env examples

- Add `docs/deploy.md` with these steps in order, written for someone who has never deployed this project: (1) create a Neon project in the Singapore region for production only, separate from development and tests, and copy its **direct** (non-pooled) connection string; (2) generate `INTERNAL_SECRET` with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; (3) in Render, New → Blueprint from this repository, enter `DATABASE_URL`, `INTERNAL_SECRET` and `TRUST_PROXY=0`; (4) wait for the first deploy and open `https://<service>.onrender.com/health`; (5) on cron-job.org create a job: `POST https://<service>.onrender.com/internal/tick` every 5 minutes, header `Authorization: Bearer <INTERNAL_SECRET>`, failure notifications on; (6) find `TRUST_PROXY`: from the phone's network call `GET /internal/ip` with the header, compare to the network's public IP, raise `TRUST_PROXY` one at a time until they match and stop there (never higher); (7) set `EXPO_PUBLIC_API_URL=https://<service>.onrender.com` in `apps/mobile/.env`; (8) run the smoke command with `API_BASE_URL` and `INTERNAL_SECRET` set; (9) optional deploy hook: copy Render's deploy hook URL into `RENDER_DEPLOY_HOOK_URL` locally, never commit it; (10) rotate `INTERNAL_SECRET`: change it in Render, then in cron-job.org; (11) what happens when a migration or start fails (Render keeps the previous deploy live) and where to see it in Render's events and logs. Explain that `401 unauthorized` from the tick means the header or secret is wrong.
- `apps/api/.env.example`: add `INTERNAL_SECRET=` with a placeholder of 32+ characters that is obviously not real and a comment on generating one; change the `TRUST_PROXY` comment to point to `docs/deploy.md`.
- `apps/mobile/.env.example`: add a comment that production uses the `https://<service>.onrender.com` URL (see `docs/deploy.md`).

Depends on: none
Verify: a reviewer follows `docs/deploy.md` and finds every step from spec R14 in a working order; the `.env.example` files contain no real secret.

### 6. Record the user's setup steps

Run `ourkit pending add` once for each step only the user can do: create the Neon production project (Singapore, direct connection string); create the Render service from the Blueprint and enter its variables; create the cron-job.org job; set `TRUST_PROXY` after checking `/internal/ip`; set the production `EXPO_PUBLIC_API_URL`. Each points to `docs/deploy.md`.

Depends on: none
Verify: `ourkit pending` lists all five steps.
