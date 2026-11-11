# Tasks: People can create projects and work on them offline

Spec: `.ourkit/specs/claude-ourkit-spec-4-feature-flow-40dfbf.md`. Plan: `.ourkit/plans/claude-ourkit-spec-4-feature-flow-40dfbf.md`. Read both before starting any task. The plan's Changes section is the design to follow; requirement numbers (R) and acceptance criteria (AC) refer to the spec.

API tests need `TEST_DATABASE_URL` in `apps/api/.env` (a separate local database whose name ends in `_test`). If it isn't set, `ourkit gate run test` reports `not-run`. Report that as not run, never as passed, and never point tests at `DATABASE_URL`. Network failures in mobile tests are simulated with fake senders that throw `ApiError("network")`, never with real sockets. Mobile packages are installed with `npx expo install` from `apps/mobile`, and must be modules bundled in Expo Go.

## Tasks

### 1. API schema, migration and test helpers for projects

In `apps/api`:

- In `prisma/schema.prisma`:
  - Add `enum Currency { VND USD }` and `enum ProjectRole { owner member }`.
  - Add the `Project` model: `id String @id` with no default, `name`, `description String @default("")`, `currency Currency`, `nameEditedAt`, `descriptionEditedAt`, `currencyEditedAt` (all `DateTime`), `createdAt`, `updatedAt @updatedAt`, `members ProjectMember[]`.
  - Add the `ProjectMember` model: `projectId`, `userId`, `role ProjectRole`, `createdAt`, `@@id([projectId, userId])`, `@@index([userId])`, with relations to `Project` and `User`, both `onDelete: Cascade`.
  - Add `projects ProjectMember[]` to `User`.
- Create the migration with `npm --prefix apps/api run db:migrate -- --name projects`. It must only add types, tables, indexes and foreign keys, and must not alter existing tables apart from the new relations. Commit the migration folder.
- In `src/test/helpers.ts`:
  - Add `"Project"` to the `TRUNCATE` list.
  - Add an exported `createSignedInUser(clock, overrides?)` that creates a user (hashed password) and a session, and returns `{ user, token }`. It is modelled on the inline `signedInUser` in `src/me/routes.test.ts`. Don't change the existing tests.
- Add `src/projects/schema.test.ts`, which checks AC 2 and AC 34 against the test database:
  - inserting the same `(projectId, userId)` twice fails;
  - deleting a user removes their memberships;
  - deleting a project removes its memberships.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass; the migration SQL contains only `CREATE` statements plus foreign keys.

### 2. API projects router with per-field last-write-wins

Add `apps/api/src/projects/routes.ts` exporting `createProjectsRouter(deps: { prisma, now })`, following the style of `src/me/routes.ts`: `requireAuth`, strict zod schemas, `AppError`, and `next(err)`. Mount it in `src/app.ts` as `app.use("/projects", ...)`. The response for a project is `{ id, name, description, currency, role }`.

- **Validation (R1):**
  - name is trimmed, 1–80 characters;
  - description is trimmed, at most 500 characters, and optional (defaults to `""`);
  - currency is `VND` or `USD`;
  - `id` is a uuid;
  - every `editedAt` is an ISO datetime.
  - Clamp every `editedAt` to `min(editedAt, deps.now())` (R14).
- **`GET /projects`:** the caller's projects with their role, ordered by name (R6).
- **`POST /projects`**, body `{ id, name, currency, description?, editedAt }`, strict, so a `members` field is refused (R3–5):
  - In a transaction, read the project by id:
    - If the caller is a member, return it with `200`.
    - If it exists and the caller isn't a member, refuse with `409 id_conflict` and leave it unchanged.
    - Otherwise create it with all three `*EditedAt` set to the clamped time, plus an `owner` membership, and return `201`.
  - On a P2002 unique violation, which means a concurrent identical create, re-read and apply the same rules. Reuse the P2002 check from `src/auth/routes.ts`.
- **`PATCH /projects/:id`**, body `{ fields: { name?, description?, currency? } }`, strict, each field `{ value, editedAt }`, at least one field (R7, R8, R12–15):
  - A non-member or a missing project gives `404 not_found` (with the same body in both cases). A member who isn't an owner gives `403 forbidden`.
  - Per field, in one transaction, run `updateMany({ where: { id, <field>EditedAt: { lt: clamped } }, data: { <field>: value, <field>EditedAt: clamped } })`.
  - Then return the project's current state with `200`, even if nothing changed.
- **`DELETE /projects/:id`** (R9, R10):
  - A non-member or a missing project gives `404`, and a non-owner gives `403`.
  - Otherwise run `deleteMany({ where: { id } })`. A count of `0` gives `404`, and success gives `204`. Memberships are removed by cascade.
- **Tests:** add `src/projects/routes.test.ts`, using `useTestApp`, `createClock`, `expectError` and `createSignedInUser`, covering AC 1, 3–7 and 9–15. Insert Member rows directly with Prisma where a non-owner member is needed.

Depends on: 1
Verify: `ourkit gate run test` and `ourkit gate run build` pass, with tests for every AC listed above.

### 3. Mobile test command and currency formatter

In `apps/mobile`:

- Add `vitest` as a dev dependency.
- Add `vitest.config.ts`, with `include: ["src/**/*.test.ts"]` and a node environment.
- Add the script `"test": "tsc --noEmit && vitest run"`. If `tsc --noEmit` fails on existing code, report it rather than changing unrelated files.
- Add `src/lib/currency.ts` exporting `formatMoney(amount: number, currency: "VND" | "USD"): string` (R16):
  - VND rounds to a whole number, groups thousands with `.`, and ends with ` ₫`, for example `1.250.000 ₫`.
  - USD uses two decimals, groups thousands with `,`, and starts with `$`, for example `$1,250.50`.
  - Negative numbers carry a leading `-`.
  - Implement it by hand, without `Intl`.
- Add `src/lib/currency.test.ts` covering AC 16, including `0`.

In `.ourkit/stack-profile.json`, change the `test` command to `npm --prefix apps/api test && npm --prefix apps/mobile test`.

Depends on: none
Verify: `npm --prefix apps/mobile test` passes; `ourkit command test` prints the combined command; `ourkit gate run lint` passes.

### 4. Generic write queue in `src/sync`

In `apps/mobile`, install `@react-native-async-storage/async-storage` with `npx expo install`. Then add these files. None of them may import anything from `src/projects`.

- **`src/sync/storage.ts`:** a `KeyValueStore` interface with `getJSON`, `setJSON` and `remove`. Provide `asyncStorageStore` (AsyncStorage) and `createMemoryStore()` for tests.
- **`src/sync/queue.ts`:** the generic queue.
  - A `Change` is `{ changeId, entity, entityId, kind: "create" | "update" | "delete", data: Record<string, unknown>, fieldTimes: Record<string, string>, createdAt }`.
  - `createQueue({ store, getToken, onSignedOut, onApplied, onRejected })` returns `{ enqueue, flush, waiting, count, clear, ownerId, setOwner }`. The queue is persisted under one key together with its owner `userId`.
  - **`registerEntity(entity, senders)`** takes `senders: Record<"create" | "update" | "delete", (change, token) => Promise<unknown>>`, so a missing kind is a type error. Enqueuing a change for an unregistered entity throws.
  - **Merge rules (R23)**, for the same `(entity, entityId)` while it is unsent:
    - update + update merges fields, keeping each field's latest value and time;
    - create + update folds into the create;
    - create + delete drops both;
    - update + delete becomes a single delete.
    - A change already being sent is never merged into.
  - **`flush()`** runs one at a time (with a rerun flag, as in `flushPendingLanguage` in `src/auth/AuthProvider.tsx`) and sends in order. For each result:
    - success: call `onApplied(change, response)` and remove the change.
    - `ApiError` `network`: stop and keep this change and the rest.
    - `not_signed_in`: stop, keep everything, and call `onSignedOut()`.
    - status `403`/`404`/`409`, or `validation_failed`: remove the change and call `onRejected(change, error)`.
    - Any other error: stop and keep.
- **`src/sync/queue.test.ts`**, using the memory store and fake senders:
  - covers AC 22–27 at the queue level (merge cases, order, retry after `network`, no double send when `flush` is called during a run, removal and callbacks on accept, rejection and 401);
  - covers persistence across a new `createQueue` on the same store;
  - checks that the owner is kept.

Depends on: 3
Verify: `npm --prefix apps/mobile test` passes (including `tsc --noEmit`); `ourkit gate run lint` passes; `src/sync` has no import from `src/projects`.

### 5. Projects data layer: API calls, cache and overlay

In `apps/mobile`, install `expo-crypto` with `npx expo install`. Then:

- **`src/projects/api.ts`:** typed `Project` (`{ id, name, description, currency, role }`), with `listProjects`, `createProject`, `patchProject` (body `{ fields: { name?|description?|currency?: { value, editedAt } } }`) and `deleteProject`, over `request()` in `src/lib/api.ts`.
- **`src/projects/store.ts`:**
  - Pure functions:
    - `applyOverlay(serverList, waitingChanges)` applies waiting project creates, updates and deletes on top of the server list (R19). Changes for other entities are ignored.
    - `validateProjectInput` uses the same limits as the server (R1, R32), with trimming.
    - `newProjectId()` uses `expo-crypto` `randomUUID`.
  - Persistence through `KeyValueStore`: a cache `{ userId, projects, currentProjectId }`, with load, save and clear.
  - Keep `newProjectId` in its own file if `expo-crypto` can't be imported under vitest.
- **`src/projects/sync.ts`:** `registerProjectEntity(queue)` registers the `project` senders that map a `Change` to the API calls above.
- **`src/projects/store.test.ts`:** AC 19 (a waiting rename survives a refresh that has the old name; a refresh without B removes B; a waiting create shows; a waiting delete hides), plus validation limits.

Depends on: 4
Verify: `npm --prefix apps/mobile test` passes; `ourkit gate run lint` passes.

### 6. ProjectsProvider, sync triggers and the sign-out / 401 split

In `apps/mobile`, install `@react-native-community/netinfo` with `npx expo install`. Then:

- **`src/sync/triggers.ts`:** `startSyncTriggers(flush)` calls `flush` on AppState `active` and on the NetInfo transition from offline to online, and returns an unsubscribe function (R24).
- **`src/projects/ProjectsProvider.tsx`**, plus a `useProjects()` hook. Mount it inside `AuthProvider` in the app layout.
  - On a signed-in user it:
    - loads the cache at once (R17);
    - sets the queue owner, clearing the cache and queue if the stored owner is a different user (R28);
    - refreshes from `listProjects` when reachable, saves `applyOverlay(server, waiting)` (R19);
    - flushes the queue;
    - exposes `status` (`loading` / `ready` / `offline`) for the offline note (R18).
  - `create`, `update` (changed fields only) and `remove` update the cache at once and enqueue a change with `editedAt` set to now (R21). Each sets `fieldTimes`, so merged changes keep per-field times.
  - `onApplied` writes the server's project to the cache. A delete or `404` removes it.
  - `onRejected` restores the server's version on the next refresh, removes the project for a `404`, and sets a `rejectedNotice` that the screens show (R26).
  - It tracks `currentProjectId`, saved in the cache. If the stored project no longer exists after a refresh, it clears it (R29, R31).
  - It exposes `waitingCount`.
- **`src/auth/AuthProvider.tsx`:**
  - Separate the user's sign-out from a 401. On `signOut`, clear the project cache, the queue and `currentProjectId` before the session ends. When `endSession` runs because the server said `not_signed_in`, keep them (R27, R28).
  - Expose a way for `ProjectsProvider` to call that clearing, and to send the queue's `onSignedOut` to the existing `not_signed_in` handling. Keep all current language-sync behaviour unchanged.

Depends on: 5
Verify: `npm --prefix apps/mobile test` and `ourkit gate run lint` pass; by hand in Expo Go: AC 17, 20, 27 and 28 (Test Handoff).

### 7. Project screens and translations

In `apps/mobile`, using the existing `src/ui` components, theme tokens, DESIGN.md (offline and pending notes as small `textSecondary` text, no pop-ups for routine saves) and Decision 10 (compact vertical flows, collapsible sections starting closed, no tables):

- **`app/(app)/index.tsx`** becomes the current project screen:
  - The project's name, currency and a collapsible details section with the description.
  - The offline and pending notes, and the `rejectedNotice`.
  - A switcher row linking to the list.
  - With no current project, it redirects to the list (R18, R29, R31).
- **`app/(app)/projects/index.tsx`** is the list. Tapping a project makes it current and goes back. It has an empty state with a create button (R30).
- **`app/(app)/projects/new.tsx`** and **`app/(app)/projects/[id]/edit.tsx`** are the forms for name, currency (VND/USD using `ChoiceRow`) and description, validated with `validateProjectInput` and showing per-field messages (R32).
  - Edit and Delete are shown to owners only.
  - Delete confirms with the project's name and says it can't be undone (R9, R32).
- **`app/(app)/settings.tsx`:** when `waitingCount > 0`, signing out first asks for confirmation that waiting changes will be lost (R28).
- **`src/i18n/en.json`, `vi.json`:** add `projects.*` strings and `errors.forbidden` and `errors.id_conflict`. Use no literal strings in JSX (the lint rule enforces this).

Depends on: 6
Verify: `ourkit gate run lint` and `npm --prefix apps/mobile test` pass; by hand in Expo Go, both languages: AC 8 note, 18, 21, 29–33 (Test Handoff). The Member check in AC 32 needs a `ProjectMember` row with role `member` inserted by SQL.

### 8. Update the roadmap's conflict line

In `docs/roadmap.md`, replace the line saying conflict handling is deferred with: conflicting edits resolve last-write-wins per field (Epic Decision 4, ticket #4). Change nothing else.

Depends on: none
Verify: `git diff docs/roadmap.md` shows only that line changed.
