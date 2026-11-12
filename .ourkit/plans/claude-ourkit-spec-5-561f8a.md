# Plan: Owners can invite people with a single-use link

Spec: `.ourkit/specs/claude-ourkit-spec-5-561f8a.md` (#5).

## Approach

The API changes are:
- an `Invite` table;
- two routers mounted beside `/projects`, following the existing `createXRouter({ prisma, now })` pattern: invites and members under `/projects/:id/...` plus `POST /invites/join`, and a public `GET /i/:code` page router;
- a pure `renderInvitePage` function for the HTML.

Every membership change goes through one interactive transaction that first locks the project row (`SELECT ... FOR UPDATE`, parameterized `$queryRaw`). The member cap, the last-Owner rule and single use then hold under concurrency, without Serializable retries. Invite codes come from `crypto.randomInt` over the 31-character alphabet. They are stored as an HMAC-SHA256 keyed by a key derived from `INTERNAL_SECRET`, so a database leak can't brute-force the 2^40 code space and no new secret is needed.

On the phone:
- two new stack screens, Members and Join, and an `AvatarRow` component driven by a pure `avatarRowModel` function;
- the core `Share` and `ActionSheetIOS` APIs, so no new dependency;
- a small persisted members cache and a persisted profile;
- a queue `dropEntity` call that a refresh uses to drop writes for projects the person no longer belongs to.

## Prior Art

- **Rate limiting:** reuse `createSignInLimiter` from `auth/rate-limit.ts` as-is. It reserves in-flight attempts and honours `TRUST_PROXY` through `req.ip`.
  - Join: `pairLimit: Infinity`, `emailLimit` = 10 per account (the userId goes in the `email` key), `ipLimit` = 30 per IP, over 15 minutes.
  - Page: a separate instance with only `ipLimit` = 60 per IP over 15 minutes, calling `fail()` on every lookup, as sign-up does.
- **Hashing:** `hashToken` (unkeyed sha256) is not used for codes, because with 31^8 ≈ 2^40 it would be brute-forceable from a leak. Write a new `invites/code.ts` with `generateCode`, `normalizeCode` and `hashCode` (HMAC). The key is derived once as `HMAC(INTERNAL_SECRET, "invite-code-v1")`. Downside: rotating `INTERNAL_SECRET` voids pending invites. That's acceptable for 7-day invites, and it will be noted in `docs/deploy.md`.
- **Atomic single use:** follow the `updateMany` plus count-check pattern from `projects/routes.ts:193` and `http/last-write-wins.ts`, inside the locked transaction.
- **Errors, auth and helpers:** reuse `AppError`, `requireAuth`, `findForMember` and `requireOwner` (moved to a shared `projects/access.ts` so the new routers use the same 404/403 rules), plus `useTestApp`, `createSignedInUser` and `expectError`. The truncate needs no change, because `Invite` cascades from `Project`.
- **HTML:** no templating library or helmet. One page doesn't justify a dependency, so I'll use a hand-written `escapeHtml` and set the headers by hand.
- **Mobile:** reuse `request()`/`ApiError` (code `network` = offline), `Collapsible` (starts closed), `Button`, `Card`, `Screen`, `Enter`, `Alert`, and `commit()` in ProjectsProvider, which already clears a vanished current project. Mirror `routing.ts` and `outcomes.ts` for pure decision functions. React Native core `Share.share` and `ActionSheetIOS` need no new package.
- **Write new:** there is no Avatar, no member cache and no per-entity queue drop, so those are new.

## Changes

### API (`apps/api`)

1. **Schema and migration** (`prisma/schema.prisma`, new migration that only adds):
   - `Invite { id uuid, projectId → Project (cascade), codeHash unique, createdById → User? (SetNull), createdAt, expiresAt, usedById → User? (SetNull), usedAt?, revokedAt? }`, with `@@index([projectId])`. Back-relations go on User and Project.
   - `ProjectMember` already has `createdAt`, which serves as "joined at".
2. **`src/config.ts`:** optional `INVITE_INSTALL_URL`. When set, it must parse as a URL with protocol `https:`, or loading throws `ConfigError`. It goes in `.env.example` and `render.yaml` as optional, with one line in `docs/deploy.md` (also noting that rotating `INTERNAL_SECRET` voids pending invites).
3. **`src/invites/code.ts`:** `generateCode()`, `normalizeCode(input)` (strip spaces and dashes, uppercase, check 8 characters from the alphabet, otherwise null), `formatCode` (`XXXX-XXXX`) and `hashCode(code, key)`.
4. **`src/projects/access.ts`:** move `findForMember` and `requireOwner` here, plus `lockProject(tx, id)`, which runs `SELECT id FROM "Project" WHERE id = ${id} FOR UPDATE`.
5. **`src/invites/routes.ts`** (`createInvitesRouter`, behind `requireAuth`):
   - `POST /projects/:id/invites` (Owner): inside the lock, counts pending invites (≥ 20 → 409 `too_many_invites`) and creates one. Returns 201 `{ id, code: "XXXX-XXXX", expiresAt }`.
   - `GET /projects/:id/invites` (Owner): pending invites only, newest first, at most 20 by rule, `{ id, createdBy: { displayName } | null, createdAt, expiresAt }`. No code.
   - `DELETE /projects/:id/invites/:inviteId` (Owner): sets `revokedAt` if still pending, then 204 either way. An invite from another project gives 404.
   - `POST /invites/join` `{ code }` (zod):
     1. Reserve a limiter slot; on refusal, 429 `too_many_attempts`.
     2. Normalize the code; if that fails, `invalid_invite`.
     3. Look up by hash. If missing or not pending, `invalid_invite`.
     4. Inside a transaction: lock the project, check existing membership (409 `already_member`), check the member count (≥ 50 → 409 `project_full`), then claim the invite with `updateMany where { id, usedAt: null, revokedAt: null, expiresAt > now }`. A count of 0 gives `invalid_invite`. Then insert the `member` row.
     5. On success, release the limiter slot and return 200 with the project in `GET /projects` item shape. Failures call `fail()`.
6. **`src/members/routes.ts`** (`createMembersRouter`, behind `requireAuth`):
   - `GET /projects/:id/members` (any member): `{ userId, displayName, role, joinedAt }`, ordered by role (owner first), then `createdAt`, then `userId`. No email. At most 50 by rule.
   - `PATCH /projects/:id/members/:userId` `{ role: "owner"|"member" }` (Owner): inside the lock; demoting the last Owner gives 409 `last_owner`. Returns the member.
   - `DELETE /projects/:id/members/:userId` (Owner): the caller's own id gives 400 `validation_failed` ("use leave"). Inside the lock, the last-Owner check, then delete, then 204.
   - `POST /projects/:id/leave` (any member): inside the lock, the last-Owner check, then delete, then 204. The 409 `last_owner` carries `message` only. The phone decides between "make someone Owner" and "delete instead" from its cached member count.
7. **`src/invites/page.ts` and `src/invites/page-routes.ts`:**
   - `pickLanguage(acceptLanguage)`: parses q-values and returns `en` only when English has a higher q than Vietnamese (absent counts as 0); the default is `vi`.
   - `renderInvitePage({ lang, invite | null, installUrl })` returns HTML with every value escaped, from a two-language string table.
   - `GET /i/:code`: no auth, limiter per IP, headers `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `X-Content-Type-Options: nosniff`. Responds 200 for a valid invite, otherwise 404 with the same generic body (and 429 with the generic body when limited).
8. **`src/app.ts`:** mount the two routers and the page router before `notFoundHandler`.

### Mobile (`apps/mobile`)

9. **`src/lib/api.ts`:** typed calls `createInvite`, `listInvites`, `revokeInvite`, `joinProject`, `listMembers`, `setMemberRole`, `removeMember` and `leaveProject`.
10. **`src/members/`:**
    - `avatarRow.ts`: pure `avatarRowModel(members)` returning `{ avatars: [{ userId, initial }] (≤3), more: number | null }`. The initial is the first character of the trimmed name, uppercased with the locale-aware method, so `đ` becomes `Đ`.
    - `memberCache.ts`: persisted `members.cache.v1` keyed by `{ userId }`, then per project, holding the last list. It's cleared on sign-out and owner change, like the projects cache.
    - `useMembers(projectId)`: shows the cached list, refreshes online, and on a `network` error keeps the cache.
11. **`src/ui/Avatar.tsx` and `src/members/AvatarRow.tsx`:** the circle uses `field` fill, `text` letters and a 2px `background` ring, overlapping by 11 (as in the mockup). The `+N` circle is the same style in `textSecondary`. The `+` circle has a dashed `accent` border. The whole row is one `Pressable` with an accessible label (`members.rowLabel`, with count). It's hidden when there's no cache and the phone is offline.
12. **Screens** (in `src/app/(app)/(home)/`):
    - `projects/[id]/index.tsx` gets the AvatarRow under the role line.
    - New `projects/[id]/members.tsx` holds:
      - the Owner-only **Mời bằng mã** button, which calls `createInvite` and then `Share.share({ message })`;
      - the member list with "(Bạn)" next to the viewer;
      - an Owner-only per-row `ActionSheetIOS` with Make Owner / Make Member, Remove (confirmed with `Alert`) and Cancel;
      - the Owner-only `Collapsible` **Pending invites** with Revoke (confirmed);
      - **Rời dự án** for everyone, confirmed, then refresh and `goToList`.
    - New `projects/join.tsx` has the code field, the Join button and error mapping; on success it refreshes, sets the current project and replaces to `projects/[id]`, so back goes to the list.
    - `projects/index.tsx` gets a **Join with code** entry.
    - Errors map from `ApiError.code` to translated messages. `network` shows `errors.network`.
13. **`src/sync/queue.ts`:** `dropEntity(entity, entityId)` with the same epoch fencing as `clear()`. `syncCycle.refresh` calls it for every queued project id missing from the server list (a pure `projectsToDrop(server, queued)` in `outcomes.ts`).
14. **Profile:** `AuthProvider` persists `{ userId, email, displayName }` in a `profile.v1` store, written on `getMe`, sign-in and sign-up, read at start when the token is present, and cleared in `endSession`. `account.tsx` adds a **Your profile** `Card` above Language, showing the name in `bodyStrong` and the email in `caption`, and nothing when neither is known.
15. **i18n:** new `members.*`, `invites.*`, `join.*` and `profile.*` keys, plus error keys `invalid_invite`, `already_member`, `project_full`, `too_many_invites`, `last_owner`, `last_owner_only_member`, in `en.json` and `vi.json`.
16. **`DESIGN.md`:** replace "no initials avatars" (line 94) and "rainbow initials avatars" (line 140) with a **Member avatar** entry: single-tone initials in `field`/`text` with a `background` ring, overlapping stack of at most 3, `+N`, dashed accent `+`. Multicoloured initials stay banned.

### Requirement coverage

| Requirement | Where it's built |
|---|---|
| 1–8 (invites) | items 1, 3–5, 9, 12 |
| 9–13 (web page) | items 2, 7, 8 |
| 14–19 (joining) | item 5 |
| 20–27 (members) | items 4, 6 |
| 28–29a (offline, navigation, avatar row) | items 10–12 |
| 30–35 (screens, share text, join screen, losing access, last Owner, i18n) | items 12, 13, 15 |
| 36 (profile card) | item 14 |
| 37–38 (data) | item 1 |

## Risks

- **Sensitive Areas: auth, data, schema, public API.** This changes who can access a project. Review needs the sensitive reviewer.
  - Mitigation: every new route reuses the shared access helpers; tests cover 404 for non-members and 403 for Members on every route.
- **Races** (two Owners demoting each other, two joins on one code, the 50-member cap):
  - The project-row lock serializes membership changes per project. Concurrent tests use `Promise.all`, as the sign-up race test does.
  - `$queryRaw` uses the tagged-template form only, never string building.
- **Code guessing:** per-account and per-IP limits on join and per-IP on the page, with an HMAC-stored code. The limiter is in memory and per process, which is acceptable for one Render instance (Out of Scope in the spec).
- **XSS on the invite page:** project names and display names are user-written, so every value is escaped and the CSP forbids scripts. There's a test with `<script>` and quotes.
- **Rotating `INTERNAL_SECRET` voids pending invites:** documented in `docs/deploy.md`. People just create new ones.
- **Queue drop racing an in-flight send:** reuse the epoch fencing from `clear()`, with a unit test.
- **Profile left behind after sign-out on a shared phone:** cleared in `endSession`, with the owner checked on read, as the projects cache does (Lessons: act on every field a decision returns).
- **Design rejected after build:** the mockup is approved before Build (Lessons).
- **Review looping on nits:** fix only blocking findings, and list non-blocking ones for the user (Lessons).

## Test Strategy

Tests run only through `ourkit gate run test` (`npm --prefix apps/api test && npm --prefix apps/mobile test`), plus `gate run lint` and `gate run build`. Each piece of behaviour gets a failing test first.

- **API, against the real `_test` database (Vitest, serial):**
  - New `invites/routes.test.ts` for AC1–AC7 and AC11–AC15.
  - New `members/routes.test.ts` for AC16–AC20.
  - New `invites/page-routes.test.ts` for AC8, AC9 and the 429 part of AC11.
  - `config.test.ts` gains cases for AC10.
  - `code.test.ts` covers the alphabet and normalization (AC2).
  - Migration on existing data (AC26): a test inserts projects and members, then checks they're unchanged after the full migrate in global setup. The migration only adds, so this asserts the existing rows still read back unchanged.
  - Races (AC15, AC18): `Promise.all` against the real database, run several times inside the test to catch flakiness.
  - Network failures aren't simulated on the API side. On the phone, the `network` code is tested through the pure error-mapping function only. The test strategy is decided now so Review doesn't flip it (Lessons).
- **Mobile (Vitest, node, pure functions only):**
  - `avatarRow.test.ts` (AC28 logic).
  - `projectsToDrop` and the `queue.dropEntity` fencing (AC21).
  - The `memberCache` and profile store owner-checks, plus the offline fallback (AC27 logic).
  - The join error mapping (AC23 logic).
  - `i18n/parity.test.ts`, checking the same keys in en and vi (AC25).
- **Test Handoff (by hand on iPhone in Expo Go, at the QA Stage):**
  - AC22: navigation map, back and swipe-back.
  - AC23: share sheet text, Join, error messages, collapsed pending invites, no manage actions for Members.
  - AC24: offline behaviour.
  - AC27: profile card, switching account.
  - AC28: visual overlap, ring, single colour, tap target.
  - The invite page opened from Zalo or Messenger on a phone browser, in VI and EN.
- **Not automated:** React Native rendering, since there are no component tests in this project. These items are covered by the Test Handoff above.
