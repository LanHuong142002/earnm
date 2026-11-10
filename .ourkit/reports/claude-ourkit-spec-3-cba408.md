# Change Report: The API runs on Render and stays awake (#3)

## Summary

What changed: a Render Blueprint (`render.yaml`) for the API, secret-protected `POST /internal/tick` and `GET /internal/ip`, a config loader that requires `INTERNAL_SECRET`, `smoke` and `deploy` commands, and a Vietnamese deploy guide (`docs/deploy.md`).
Why: so the API runs in production on Render's free plan in Singapore, cron-job.org keeps it awake every 5 minutes, and the two deploy notes from #2 (HTTPS and the right `TRUST_PROXY`) can be done.
How it was verified: 130 API tests on the test database, API build and mobile lint, a local start with migrations plus smoke runs, two review rounds each with a Sensitive Reviewer (no blocking findings), and QA against all 14 Acceptance Criteria.
What to watch for: `npm run dev` now needs a 32+ character `INTERNAL_SECRET` with no spaces in `apps/api/.env`, migrations run on every start and are never rolled back, and sign-in must not open to real users until `TRUST_PROXY` is set.
What's left: everything on Render, Neon and cron-job.org is the user's to do after merge (`docs/deploy.md`, `ourkit pending`), and 6 Acceptance Criteria can only be checked there.

## Details

### Decisions

- **Blueprint plus migrate on start.** Render's free plan has no pre-deploy step, so the start command is `npm run db:deploy && npm start`. A failed start keeps the previous code serving, but an applied migration stays, so migrations must be backward-compatible (add first, remove later). This is in `render.yaml` and `docs/deploy.md` section 11.
- **`autoDeployTrigger: commit`** instead of `autoDeploy: true`, because Render's Blueprint spec marks `autoDeploy` as deprecated.
- **The tick doesn't touch the database.** Neon's free compute can't cover running 24/7, so Neon may sleep and wakes on the next real query.
- **One secret, `INTERNAL_SECRET`, for both internal endpoints.** It needs at least 32 characters and no whitespace. Both sides are SHA-256 digested and compared with `timingSafeEqual`. Any failure gives `401 unauthorized` in the existing error format. Without a configured secret, every request is refused.
- **`TRUST_PROXY` stays 0 until checked.** `GET /internal/ip` exists so the user can find Render's hop count by hand, rather than guessing it.
- **Direct Neon connection string** for both migrations and the app. It's fine at this scale; split into a pooled runtime URL and a direct migration URL when traffic grows.
- **Smoke refuses to send the secret over plain `http://`** except to localhost, and waits up to 60 s per check for a sleeping service.
- **No new dependencies.**

### Review

- Round 1 (general and Sensitive Reviewer): no blocking findings and 9 non-blocking. The user chose to fix all 9:
  - the `.env.example` placeholder secret passed the length check;
  - a secret with whitespace could never match;
  - smoke could send the secret over http;
  - the rollback wording in the docs was wrong;
  - sign-in limits are shared until `TRUST_PROXY` is set;
  - the smoke timeout was too short for a cold start;
  - the secret appeared in shell history;
  - the IP test was too weak;
  - the closed-port test could flake.
- Round 2: no blocking findings and 7 non-blocking.
  - Fixed: the docs now pass the header via stdin and clear the variable.
  - Fixed: a pending note tells developers to add `INTERNAL_SECRET` locally.
  - Accepted and logged: the direct Neon URL at runtime, `PORT` not validated (pre-existing, and Render always sets it), the two extra hardening rules beyond R1 and R13, and the smoke "not running" test using an injected fetch.

### QA

The installed ourkit (0.3.1) has no `qa` commands, so the `ourkit-qa` subagent's results are recorded here by hand.

| # | Criterion | Result | How it was checked |
|---|---|---|---|
| 1 | Startup refuses a missing or short secret | pass | Tests; a live start with a short secret exits 1 and names the variable |
| 2 | Tick returns 200 and uses no database | pass | Test with a database client that throws on use; live tick returns `{"status":"ok"}` |
| 3 | `/internal/ip` honours `TRUST_PROXY` | pass | Tests for `trustProxy` 1 and 0; live call returns `::1` |
| 4 | Wrong or missing secret gives 401, constant-time | pass | Five rejection cases on both endpoints; reviewers confirmed digest-then-`timingSafeEqual` |
| 5 | Secret never logged or returned | pass | Server logs had no secret; console spies in tests; reviewers found no path |
| 6 | Existing tests unchanged and passing | pass | 130 tests pass; no existing test file modified |
| 7 | `render.yaml` fields, build, local start | pass | Fields read; build passes; in Build, `db:deploy` and `npm start` against the dev database applied migrations and served, with smoke passing. QA's own rerun of `migrate deploy` was blocked by a tool safety check |
| 8 | Failed start keeps the previous deploy | manual | After the first deploy, on Render |
| 9 | Neon production in Singapore, separate from dev | manual | In the Neon console |
| 10 | `deploy` command | pass / manual | Unset hook URL exits 1 naming the variable; a real trigger is the user's (production) |
| 11 | `smoke` command | pass | Right secret passes; wrong secret fails without printing either; no server fails on `/health` |
| 12 | Server stays awake | manual | After 30 minutes of cron, `/health` under 2 s and no sleep restart |
| 13 | HTTPS sign-in and real IP | manual | iPhone sign-in over `https://`; `/internal/ip` shows the network's public IP |
| 14 | Docs, env examples and pending steps | pass | All 11 steps present and in a working order; `.env.example` files updated; `ourkit pending` lists the steps |

### Test Handoff

These need the user's accounts, after the PR is merged into `main`. Follow `docs/deploy.md` in order:

1. Create the Neon production project in Singapore and copy its direct connection string. Check criterion 9.
2. Create the Render service with New → Blueprint and enter the three variables. After the first deploy, `/health` returns 200.
3. Create the cron-job.org job. After 30 minutes, check criterion 12.
4. Find `TRUST_PROXY` with `/internal/ip`, then sign in from an iPhone over `https://`. Check criterion 13.
5. Run `smoke` against the Render URL. Optionally run `deploy` with the hook URL (criterion 10).
6. When a deploy first fails, confirm the previous one kept serving (criterion 8).

### Not verified

- Render accepting `render.yaml` as written. It was checked only against Render's documentation.
- Render's real proxy hop count, and anything else on Render, Neon or cron-job.org.

### Follow-ups

- Upgrade ourkit in the project, so QA can be recorded with its own commands.
- When traffic grows, use a pooled Neon URL for the app and a direct one for migrations.
- Validate `PORT` like `TRUST_PROXY`.
