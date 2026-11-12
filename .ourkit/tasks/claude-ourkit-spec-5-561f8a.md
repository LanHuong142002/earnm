# Tasks: Owners can invite people with a single-use link

Spec: `.ourkit/specs/claude-ourkit-spec-5-561f8a.md`. Plan: `.ourkit/plans/claude-ourkit-spec-5-561f8a.md`. Read both before starting any task.
- The plan's Changes section is the design to follow.
- Requirement numbers (R) and acceptance criteria (AC) refer to the spec.

**API tests:**
- They need `TEST_DATABASE_URL` in `apps/api/.env`, pointing to a separate local database whose name ends in `_test`.
- If it isn't set, `ourkit gate run test` reports `not-run`. Report that as not run, never as passed.
- Never point tests at `DATABASE_URL`.

**Mobile tests:**
- They are pure-function Vitest tests in node, with no component tests.
- Network failures are simulated with fakes that throw `ApiError("network")`, never with real sockets.

**Constraints for every task:**
- No new dependency in either app.
- Every SQL in raw form uses Prisma's tagged-template `$queryRaw`, never string building.
- Errors use `AppError(status, code, message)`, giving the `{ error: { code, message } }` shape.
- Write each test first and see it fail.

## Tasks

### 1. Invite schema and migration

In `apps/api/prisma/schema.prisma`, add the `Invite` model:
- `id String @id @default(uuid())`
- `projectId` → `Project`, `onDelete: Cascade`
- `codeHash String @unique`
- `createdById String?` → `User`, `onDelete: SetNull`
- `createdAt DateTime @default(now())`
- `expiresAt DateTime`
- `usedById String?` → `User`, `onDelete: SetNull`
- `usedAt DateTime?`
- `revokedAt DateTime?`
- `@@index([projectId])`

Add the back-relations on `Project` (`invites`) and `User`. User has two relations to Invite, so name them, e.g. `"InviteCreatedBy"` and `"InviteUsedBy"`.

Create the migration with `npm --prefix apps/api run db:migrate -- --name invites`. It must only add things (R38). Commit the migration folder.

Add `src/invites/schema.test.ts` against the test database, covering R37 and AC7's cascade part and AC26:
- Deleting a project deletes its invites.
- Deleting the creating or using user keeps the invite, with that reference set to null.
- A project and member created before an invite row exists read back unchanged.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass. The new migration SQL contains only `CREATE` statements, `ADD CONSTRAINT` foreign keys and indexes.

### 2. Invite code helpers and INVITE_INSTALL_URL config

In `apps/api`:
- **`src/invites/code.ts`:**
  - `CODE_ALPHABET` = `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (31 characters, no `0 O 1 I L`).
  - `generateCode()`: 8 characters, using `crypto.randomInt`.
  - `normalizeCode(input)`: strip spaces and `-`, uppercase, then return the code if it's exactly 8 alphabet characters, otherwise `null`.
  - `formatCode(code)`: returns `XXXX-XXXX`.
  - `deriveInviteKey(internalSecret)`: `HMAC-SHA256(internalSecret, "invite-code-v1")`.
  - `hashCode(code, key)`: HMAC-SHA256 hex.
- **`src/invites/code.test.ts`** (AC2 logic):
  - 1000 generated codes use only the alphabet and are 8 long.
  - Normalization accepts `k7qm-r4xp` and ` K7QM R4XP `, and rejects 7 or 9 characters and `O`, `0`, `I`, `1`, `L`.
  - The same code and key give the same hash, and different keys give different hashes.
- **`src/config.ts`:**
  - Add optional `inviteInstallUrl: string | null`, read from `INVITE_INSTALL_URL`.
  - Empty or unset means `null`.
  - When set, it must parse with `new URL()` and have protocol `https:`, otherwise throw `ConfigError` with a clear message (R11).
  - Add cases to `src/config.test.ts` (AC10 config part).
- **Docs and deploy files:** add `INVITE_INSTALL_URL=` (commented as optional) to `apps/api/.env.example`, and add it as optional to `render.yaml`. In `docs/deploy.md`, add a short Vietnamese note on what `INVITE_INSTALL_URL` does, and that changing `INTERNAL_SECRET` makes pending invites stop working.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 3. Shared project access helpers with a row lock

In `apps/api/src/projects/`:
- Move `findForMember` and `requireOwner` out of `routes.ts` into a new `access.ts`, unchanged in behaviour: non-member, bad id or missing project gives 404 `not_found`; a Member gives 403 `forbidden`.
- Both helpers accept either the Prisma client or a transaction client.
- Add `lockProject(tx, projectId)`, which runs `` tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE` `` and returns whether a row was found.
- Update `routes.ts` to import them.
- Add `access.test.ts`. The test that matters: while one transaction holds `lockProject` on a project, a second transaction's `lockProject` on the same project only finishes after the first commits (use a deferred promise to order them). Locks on different projects don't block each other.

Depends on: none
Verify: `ourkit gate run test` passes, with all existing `projects/routes.test.ts` tests unchanged and green. `ourkit gate run build` passes.

### 4. Invites API: create, list, revoke and join

In `apps/api`:
- **`src/invites/routes.ts`:** `createInvitesRouter({ prisma, now, inviteKey })`, behind `requireAuth`, following plan item 5 exactly. It provides:
  - `POST /projects/:id/invites`
  - `GET /projects/:id/invites`
  - `DELETE /projects/:id/invites/:inviteId`
  - `POST /invites/join`
- **Rules:**
  - Owner-only routes use `requireOwner` from task 3.
  - Creating and joining run inside `prisma.$transaction` with `lockProject` first.
  - The cap is 20 pending invites (`too_many_invites`, 409). Expiry is `now + 7 days`.
  - Join errors are `invalid_invite` (404), `already_member` (409), `project_full` (409, at 50 members) and `too_many_attempts` (429).
  - Join claims the invite with a conditional `updateMany` and a count check, and returns the project in the `GET /projects` item shape (reuse `toResponse`).
  - The join limiter is `createSignInLimiter({ now, pairLimit: Infinity, emailLimit: 10, ipLimit: 30 })`, created inside the router factory, with the userId in the `email` slot.
    - Reserve with `tryAcquire` before the code is checked.
    - Call `fail()` on any refusal.
    - Call `release()` on success.
    - Read the existing sign-in route to mirror the exact calls.
- **`src/app.ts`:** mount the router (it serves both `/projects/:id/invites` and `/invites/join`) before `notFoundHandler`. Derive `inviteKey` once from `config.internalSecret` with `deriveInviteKey`.
- **`src/invites/routes.test.ts`** covers AC1, AC3–AC7 (route parts), AC11 (join part, including parallel attempts that never exceed the limit), AC12, AC13, AC14 and AC15 (two concurrent joins with one code produce exactly one member, run in a loop of 5).
  - Check the stored row never contains the plain code (AC5).
  - Use `createSignedInUser`, `expectError` and a fixed clock from `src/test/helpers.ts`.
  - Insert the extra members for the 50 cap directly with Prisma.

Depends on: 1, 2, 3
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 5. Members API: list, change role, remove and leave

In `apps/api`:
- **`src/members/routes.ts`:** `createMembersRouter({ prisma, now })`, behind `requireAuth`, following plan item 6. It provides:
  - `GET /projects/:id/members`: any member. Returns `{ userId, displayName, role, joinedAt }`, ordered owners first, then `createdAt`, then `userId`. Never an email.
  - `PATCH /projects/:id/members/:userId`: Owner only. Body `{ role }`, validated with zod and strict.
  - `DELETE /projects/:id/members/:userId`: Owner only. The caller's own id gives 400 `validation_failed`.
  - `POST /projects/:id/leave`: any member.
- **Rules:**
  - Each change runs in a transaction with `lockProject` first. It then counts Owners, and refuses with 409 `last_owner` when the change would leave none.
  - A target who isn't in the project gives 404 `not_found`.
- **`src/app.ts`:** mount the router before `notFoundHandler`.
- **`src/members/routes.test.ts`** covers AC16–AC20:
  - Include two Owners demoting each other concurrently, leaving at least one Owner, run in a loop of 5.
  - After removal, `PATCH /projects/:id` and the member list give 404, while the person's other project still works.

Depends on: 1, 3
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 6. Invite web page

In `apps/api`:
- **`src/invites/page.ts`:**
  - `pickLanguage(acceptLanguage)`: returns `"en"` only when English's highest q is greater than Vietnamese's (missing counts as 0). Otherwise `"vi"`.
  - `escapeHtml`.
  - `renderInvitePage({ lang, invite, installUrl })`, where `invite` is `{ projectName, inviterName, code, expiresAt } | null`. It returns a full HTML document with inline CSS only and no script, with VI and EN strings for every text (R9, R10, R11).
- **`src/invites/page-routes.ts`:** `createInvitePageRouter({ prisma, now, inviteKey, installUrl })`, serving `GET /i/:code` with no auth.
  - The per-IP limiter is `createSignUpLimiter`-style, `ipLimit` 60 per 15 minutes, calling `fail()` on every lookup.
  - Status is 200 for a pending invite, 404 for an unknown, malformed, used, revoked or expired one, and 429 when limited. Both non-200 cases get the generic page.
  - Set exactly the headers in plan item 7.
- **`src/app.ts`:** mount it before `notFoundHandler`, passing `config.inviteInstallUrl`.
- **Tests:**
  - `page.test.ts`: language picking, escaping (`<script>` and quotes in project and inviter names), and that the install step links only when `installUrl` is set (AC9, AC10 page part).
  - `page-routes.test.ts`: AC8, including that all four invalid cases return an identical body without the project name, plus the 429 part of AC11.

Depends on: 1, 2
Verify: `ourkit gate run test` and `ourkit gate run build` pass.

### 7. Mobile API calls, error mapping and translations

In `apps/mobile`:
- **`src/lib/api.ts`:** add typed functions, all through the existing `request()`:
  - `createInvite(token, projectId)` → `{ id, code, expiresAt }`
  - `listInvites`
  - `revokeInvite`
  - `joinProject(token, code)` → `ApiProject`
  - `listMembers` → `{ userId, displayName, role, joinedAt }[]`
  - `setMemberRole`
  - `removeMember`
  - `leaveProject`
- **`src/members/errors.ts`:** a pure `memberErrorKey(error, context)` that maps `ApiError` codes to i18n keys:
  - `network` → `errors.network`
  - `invalid_invite`, `already_member`, `project_full`, `too_many_invites`, `too_many_attempts`, `forbidden`, `not_found`
  - `last_owner` → `errors.last_owner`, or `errors.last_owner_only_member` when `context.memberCount === 1`
  - anything else → a generic key
- **Translations:** add every new key needed by tasks 7–11 to `src/i18n/en.json` and `src/i18n/vi.json`, under `members.*`, `invites.*`, `join.*`, `profile.*` and `errors.*`. Include:
  - the share message with `{{inviter}}`, `{{project}}`, `{{code}}` and `{{link}}`;
  - the row accessibility label with `{{count}}`;
  - "(You)";
  - the confirmation texts.
- **Tests:**
  - `src/members/errors.test.ts`.
  - `src/i18n/parity.test.ts`, checking that both files have exactly the same nested keys (AC25).

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run lint` pass.

### 8. Drop queued writes for projects the person lost

In `apps/mobile`:
- **`src/sync/queue.ts`:** add `dropEntity(entity, entityId)`. It removes that entity's queued ops and persists the change, using the same epoch fencing as `clear()`, so an in-flight send for it can't re-add or resolve into a stale state.
- **`src/projects/outcomes.ts`:** add a pure `projectsToDrop(serverProjects, queuedProjectIds)`. It returns the queued ids that are absent from the server list, excluding ids whose queued op is a pending create.
- **`src/projects/syncCycle.ts`:** `refresh` calls `dropEntity("project", id)` for each id from `projectsToDrop` after a successful server read.
- **Tests (AC21):** add or extend tests for `dropEntity` (including the in-flight fencing case), `projectsToDrop`, and a sync-cycle test where a refresh no longer returning a project drops its queued update and clears it as the current project.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run lint` pass.

### 9. Profile on the Account tab

In `apps/mobile`:
- **`src/auth/profile-store.ts`:**
  - `profile.v1` in AsyncStorage: `{ userId, email, displayName }`.
  - `readProfile(userId)` returns null when the stored `userId` differs.
- **`AuthProvider.tsx`:**
  - Write the profile after `getMe`, sign-in and sign-up.
  - On start with a stored token, expose the stored profile until `getMe` answers.
  - Clear it in `endSession`.
  - Expose `profile` in the context.
- **`src/app/(app)/account.tsx`:** add a **Your profile** `Card` above Language. It shows `displayName` in `bodyStrong` and `email` in `caption`/`textSecondary`, with no edit control, and nothing when no profile is known (R36). Use the `profile.*` keys from task 7, or add them in both language files if task 7 isn't done yet.
- **`src/auth/profile-store.test.ts`** (AC27 logic): round trip, the owner check, and clearing.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. The visual check on iPhone is in the Test Handoff (AC27).

### 10. Avatar row on the Project screen

In `apps/mobile`:
- **`src/members/avatarRow.ts`:** a pure `avatarRowModel(members)` returning `{ avatars: { userId, initial }[], more: number | null }`.
  - At most 3 avatars, in the given order.
  - `more` is `members.length - 3` when there are more than 3, otherwise null.
  - The initial is the first character of the trimmed `displayName`, run through `toLocaleUpperCase("vi")`.
  - Test it with 1, 3, 4 and 50 members, and with names starting `đ` and with leading spaces (AC28 logic).
- **`src/members/memberCache.ts`:**
  - Persisted `members.cache.v1` as `{ userId, byProject: Record<projectId, Member[]> }`.
  - Reading for another `userId` gives empty.
  - Cleared wherever the projects cache is cleared on sign-out or owner change.
  - Test it.
- **`src/members/useMembers.ts`:** returns the cached list for a project and refreshes it with `listMembers` when online. On `network` it keeps the cache, on `not_found` it removes that project's entry, and it exposes `refresh`.
- **Components:**
  - `src/ui/Avatar.tsx`: size 34, `field` fill, `text` colour, label weight 600, a 2px ring in the `background` token.
  - `src/members/AvatarRow.tsx`: overlap of −11, a `+N` circle in `textSecondary`, and a `+` circle with a 1px dashed `accent` border and an `accent` plus icon, 6 apart.
  - The whole row is one `Pressable` with `accessibilityRole="button"` and the label `members.rowLabel`.
  - It's hidden when there's no cached list.
- **`src/app/(app)/(home)/projects/[id]/index.tsx`:** render `AvatarRow` under the role line. Pressing it pushes `projects/[id]/members`. Create a minimal placeholder `members.tsx` route only if task 11 isn't done yet.
- **`DESIGN.md`:** at line 94, drop "no initials avatars" from the project card text. At line 140, keep the ban on rainbow/multicoloured initials. Add a **Member avatar** entry describing the tokens and stack above, matching the approved mockup.

Depends on: 7
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. The visual check is in the Test Handoff (AC28).

### 11. Members screen

`src/app/(app)/(home)/projects/[id]/members.tsx`, a stack screen whose back goes to the Project screen. It follows plan item 12, spec R29–R31 and R34, and the approved mockup:
- **Header:** the title "Members" with the back label being the project name.
- **Invite (Owner only):** a primary **Invite with code** button that calls `createInvite`, then `Share.share({ message })`. The message comes from the share message key, in the app language, with the link `${EXPO_PUBLIC_API_URL}/i/${code}` (strip any trailing `/` from the base). Closing the share sheet returns to this screen.
- **Member list:** rows show Avatar, name and role, with "(You)" for the viewer. For an Owner, every row except their own has a `⋯` that opens `ActionSheetIOS` with these actions, then refreshes `useMembers`:
  - **Make Owner** or **Make Member**, depending on the role;
  - **Remove**, confirmed with `Alert`, destructive;
  - **Cancel**.
- **Pending invites (Owner only):** a `Collapsible`, starting closed, titled with the count. Each row shows the creator and expiry date, with **Revoke** confirmed by `Alert`.
- **Leave project (everyone):** confirmed with `Alert`. On success, refresh the projects and go to the Project list. On `last_owner`, show the message from `memberErrorKey` with the cached member count.
- **Offline and errors:** every action shows the mapped error. On `network`, nothing changes and nothing is queued (R28).
- **States:** a loading state, and an error state with retry when there's no cached list.

Depends on: 7, 10
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. Behaviour on iPhone (AC22, AC23, AC24) is checked by hand in the Test Handoff.

### 12. Join with code screen

In `apps/mobile`:
- **`src/members/joinCode.ts`:** a pure `joinCodeState(input)` → `{ normalized: string | null, canSubmit: boolean }`, mirroring the API's normalization (ignore case, spaces and dashes; 8 alphabet characters). Test it.
- **`src/app/(app)/(home)/projects/join.tsx`:**
  - One code field (auto-capitalize, no autocorrect) and a **Join** button, disabled while in flight or while `canSubmit` is false (R32).
  - On success, refresh the projects, set the joined project as current, and replace this screen with `projects/[id]`, so back goes to the Project list.
  - Errors show through `memberErrorKey`.
- **`src/app/(app)/(home)/projects/index.tsx`:** add a **Join with code** entry that pushes `projects/join`.

Depends on: 7
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. Behaviour on iPhone is in the Test Handoff (AC22, AC23).
