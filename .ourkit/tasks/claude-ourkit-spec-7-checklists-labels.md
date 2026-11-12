# Tasks: Tasks can have checklists and colour labels

Spec: `.ourkit/specs/claude-ourkit-spec-7-checklists-labels.md`. Plan: `.ourkit/plans/claude-ourkit-spec-7-checklists-labels.md`. Mockup: `.ourkit/mockups/claude-ourkit-spec-7-checklists-labels.html`.

Every task reads the spec and plan first, adds its own Vietnamese and English strings to `apps/mobile/src/i18n/vi.json` and `en.json` (the parity test must pass), and leaves `ourkit gate run test` green.

## Tasks

### 1. API schema and migration for checklists and labels

In `apps/api`:

- In `prisma/schema.prisma`, add:
  - `enum LabelColour { gray red orange yellow green teal blue purple }`;
  - `Checklist`, `ChecklistItem`, `Label` (with `nameKey` and `@@unique([projectId, nameKey])`) and `TaskLabel`, exactly as in the plan's API section, with every cascade;
  - `Task.labelsEditedAt DateTime`, plus the `checklists` and `labels` relations on `Task` and `labels` on `Project`.
- Create the migration with `npm --prefix apps/api run db:migrate -- --name checklists_labels`. Its timestamp must sort after `20261112060000_tasks`.
  - Hand-edit the SQL so `labelsEditedAt` is added with a default, backfilled from `createdAt` (`UPDATE "Task" SET "labelsEditedAt" = "createdAt"`), and then made `NOT NULL` with no default.
  - It only adds a type, tables, a column, indexes and foreign keys.
- Extend `src/tasks/schema.test.ts` (R3, R7, R23, AC 23):
  - deleting a task removes its checklists and items; deleting a checklist removes its items; deleting a label removes its `TaskLabel` rows; deleting a project removes its labels;
  - two labels in one project with the same `nameKey` are refused, while the same key in another project is allowed;
  - a migration-order check like `src/invites/schema.test.ts`: the new migration directly follows the tasks one, and it applies to a database that already has a task, whose `labelsEditedAt` then equals its `createdAt`.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run build` pass; the migration SQL has no `DROP` or destructive statement.

### 2. API labels router

- Add `apps/api/src/labels/nameKey.ts`: `nameKey(name)` returns the name trimmed, NFC-normalised and lower-cased.
- Add `apps/api/src/labels/routes.ts`, `createLabelsRouter(deps)` with `Router({ mergeParams: true })` behind `requireAuth`. Mount it in `src/app.ts` at `/projects/:projectId/labels`.
- Follow `src/tasks/routes.ts`. Reuse `lockProject`, `findForMember` and `requireOwner` from `projects/access.ts`, `singleLineText(30)` from `http/text.ts`, `applyLastWriteWins` and `isUniqueViolation`.
- Routes, as in the plan:
  - `GET /`: the labels, ordered by name.
  - `POST /`:
    - idempotent on `id`, and `409 id_conflict` when the id is used elsewhere;
    - `409 label_limit_reached` at 50 labels;
    - `409 label_name_taken` when the `nameKey` is already used, including from a P2002 on the name index.
  - `PATCH /:labelId`:
    - `{ fields: { name?, colour? } }`, last-write-wins per field;
    - a rename to a taken name gives `409 label_name_taken` and rolls the whole request back;
    - returns the label as it now is.
  - `DELETE /:labelId`: Owner only (`403 forbidden`), then `204`.
  - Every write runs under the project lock. A non-member, a missing project, or a label from another project gives the same `404 not_found`.
- Add `src/labels/routes.test.ts` covering AC 6, 7, 10 (labels part) and 11 (labels part):
  - name 0 and 31 characters;
  - an unknown colour;
  - the 51st label;
  - duplicates by case, spaces and Vietnamese diacritics ("Pha chế" and " PHA CHẾ "), on create and on rename;
  - a Member creates, renames and recolours; a Member's delete gives `403`; an Owner's delete removes the label from a task (insert the `TaskLabel` row with prisma);
  - LWW: an older colour change is ignored while a newer name in the same request is accepted; a future time is capped;
  - a cross-project id;
  - `401` on every route.

Depends on: 1
Verify: `ourkit gate run test` passes, including the new labels tests.

### 3. API checklists and items router

- Add `apps/api/src/checklists/routes.ts`, `createChecklistsRouter(deps)`. Mount it at `/projects/:projectId/tasks/:taskId/checklists`, with `mergeParams`.
- Routes, as in the plan:
  - checklist `POST /`, `PATCH /:checklistId` and `DELETE /:checklistId`;
  - item `POST /:checklistId/items`, `PATCH /:checklistId/items/:itemId` and `DELETE /:checklistId/items/:itemId`.
- Rules:
  - Every id in the path must chain to the caller's project; otherwise the same `404 not_found`.
  - Every write runs under the project lock.
  - Idempotent create with `409 id_conflict`.
  - Limits: `409 checklist_limit_reached` at 10 checklists, `409 item_limit_reached` at 50 items.
  - Name: `singleLineText(60)`. Item text: `singleLineText(200)`. `done` is a boolean.
  - LWW on `name`, `text` and `done` separately.
  - Each change returns the changed checklist or item. A delete gives `204`, and a change to something deleted gives `404`.
- Any member may do all of this.
- Add `src/checklists/routes.test.ts` covering AC 1–4, 10 (checklists part), 11 (item text vs done, the future time capped) and 12.

Depends on: 1
Verify: `ourkit gate run test` passes, including the new checklist tests.

### 4. API task read shape and task labels field

In `apps/api/src/tasks/routes.ts`:

- The task response gains `labelIds: string[]` and `checklists: [{ id, name, createdAt, items: [{ id, text, done, createdAt }] }]`. Order both by `createdAt`, then `id`, through `taskInclude`.
- `PATCH` gains `fields.labels: { value: uuid[] (unique, at most 10), editedAt }`, written like `assignees`:
  - claim `labelsEditedAt` with `updateMany`;
  - only if that matched, check every id is a label of this project, otherwise `400 validation_failed` with a rollback;
  - then replace the `TaskLabel` rows.
- Extend `src/tasks/routes.test.ts` (AC 8, 9 tasks part, 11 labels set):
  - valid labels; a label from another project, an unknown id, a duplicate id, and 11 labels are refused;
  - the newer set replaces the older one as a whole;
  - reading tasks returns `labelIds` and the checklists and items in creation order (insert them with prisma).
- The existing task tests must still pass unchanged apart from the new fields.

Depends on: 1
Verify: `ourkit gate run test` passes.

### 5. Label colours in DESIGN.md and theme tokens

- Add `labelColors` to `DESIGN.md`'s front matter, with light and dark `bg`/`text` for the 8 keys, using the values in the mockup's palette table. Add short **Label chip** and **Checklist** entries under Components, matching mockups 1a and 2a.
- Mirror them in `apps/mobile/src/theme/tokens.ts` and expose them from `useTheme`.
- Add `apps/mobile/src/theme/contrast.ts` with `contrastRatio(a, b)` (the WCAG formula), and `contrast.test.ts`: all 16 pairs are at least 4.5:1, and no `bg` or `text` equals the accent `#F4511E` (R21, AC 21).

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run lint` pass.

### 6. Mobile types, API calls and pure logic

In `apps/mobile/src/tasks/`:

- `types.ts`: `Task` gains `labelIds` and `checklists`. Add the `Label`, `LabelColour`, `Checklist` and `ChecklistItem` types, matching the API in tasks 2–4.
- `api.ts`: calls for labels (list, create, patch, delete), checklists (create, patch, delete) and items (create, patch, delete).
- `progress.ts`: `taskProgress(task)` and `checklistProgress(checklist)`, each returning `{ done, total } | null`.
- `filters.ts`: `labelIds: string[]`, matching any; ids that no longer exist are ignored, and an empty list means no label filter. `store.ts`'s `isFilters` accepts copies without the field.
- `validate.ts`: checklist name 60, item text 200 and label name 30, with control characters refused; the count limits; `isDuplicateLabelName(name, labels, exceptId?)`, using the same trim, NFC and lower-case rule as the server.
- `permissions.ts`: `canDeleteLabel(role)`, true only for an Owner.
- Tests: `progress.test.ts` (AC 5), `filters.test.ts` additions (AC 20), `validate.test.ts` additions (including the Vietnamese duplicate), and `permissions.test.ts`.

Depends on: none
Verify: `ourkit gate run test` passes.

### 7. Mobile sync for labels, checklists and items

- `sync.ts`: register the `label`, `checklist` and `checklistItem` entities with the shared queue (`registerEntity`, per-entity handlers). Task updates carry an optional `labels` field. `data` carries `projectId`, `taskId` and `checklistId` as needed.
- `store.ts`:
  - the cache key becomes `tasks.cache.v2`;
  - `labelsByProject` is added;
  - the overlay applies waiting label, checklist and item changes on top of a refresh;
  - the refresh in `syncCycle.ts` also loads the project's labels.
- `optimistic.ts`: plans for each new change, each field with its own time.
- `outcomes.ts`:
  - handle the new error codes, with notice keys;
  - a refused change puts back the server's version, or removes the thing on `404`;
  - a refused label create also strips that label from the local copy and from waiting task-label changes (R15).
- Dependent waiting changes, in the `TasksProvider` actions:
  - deleting a checklist calls `dropEntity` for its items' waiting changes;
  - deleting a label locally re-enqueues waiting task-label changes without it, with a fresh time.
- `TasksProvider.tsx`: expose labels per project and the actions:
  - `createLabel`, `updateLabel`, `deleteLabel`, `setTaskLabels`;
  - `addChecklist`, `renameChecklist`, `deleteChecklist`;
  - `addItem`, `editItem`, `toggleItem`, `deleteItem`.
- Tests:
  - overlay: a waiting tick survives a stale refresh;
  - queue merging: two ticks give one change, create then rename gives one create, create then delete sends nothing;
  - outcomes: a refused item; a refused duplicate label stripped from the task and from waiting changes;
  - a checklist delete drops its items' waiting changes;
  - the cache owner check still holds with v2.
- Code check: no `label` or `checklist` reference in `src/sync/` (AC 14).
- Use fake senders that throw `ApiError("network")`, never real ports.

Depends on: 6
Verify: `ourkit gate run test` passes; `grep -riE "label|checklist" apps/mobile/src/sync` finds nothing.

### 8. Mobile label chips, progress and the task list

- In `apps/mobile/src/tasks/`, add:
  - `LabelChip` (name on the tint, sizes `sm`/`md`);
  - `LabelChips` (up to 3, then `+n`);
  - `ProgressCount` (an icon and "x/y mục" / "x/y items", with an accessible label).
- `TaskCard`: add the chips-and-progress row from mockup 1a. Show progress only when the task has items. Add the labels and progress to the card's accessibility label.
- `FilterBar`: add a "Labels" row, showing the chosen names or "All", that opens the label filter sheet route `projects/[id]/tasks/labels/filter` (route added in task 9). "Clear filters" also clears labels (mockup 1c).

Depends on: 5, 7
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. By hand (Test Handoff): mockup 1a and 1c match, in light and dark mode.

### 9. Mobile label sheets and the Labels screen

- New routes under `apps/mobile/src/app/(app)/(home)/projects/[id]/tasks/labels/`:
  - `filter.tsx`: multi-select checkboxes (`ChoiceRow`), "Clear all" and "Done" (mockup 1b);
  - `pick.tsx`, with the `taskId` param: tapping a label toggles it on the task at once; at most 10; "＋ New label"; "Manage labels ›"; the empty state (mockups 3a, 3d);
  - `form.tsx`, with an optional `labelId`:
    - name, with a live preview chip and the duplicate check;
    - `ColourSwatches`, 8 named swatches with a ✓;
    - "Create label" or "Save", and for an Owner a separate "Delete label" with an `Alert` confirmation;
    - a new label opened from the picker is also put on the task (mockups 3b, 3c, 3f, 3g);
  - `index.tsx`: the Labels screen, listing chips with ›, a caption about who can delete and the count out of 50, and "＋ New label" (mockup 3e).
- Register them in `(home)/_layout.tsx`:
  - the three sheets with `presentation: "formSheet"` and `sheetAllowedDetents`;
  - the Labels screen as a normal push with `HeaderBack` and a centred title.
- First confirm in the Expo SDK 58 docs that `formSheet` with detents works in Expo Go. If it doesn't, use `presentation: "modal"` and note it in the task report.

Depends on: 6, 7, 8
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. By hand (Test Handoff, AC 18, 19): the picker, a new label, the Member and Owner views of the Labels screen, and swipe-down and back on each sheet.

### 10. Mobile Task screen checklists and labels

- Add `ChecklistCard` and `NewChecklistField` in `apps/mobile/src/tasks/` (mockups 2a–2c, 2f):
  - header with the name, the checklist's progress and a `⋯` action sheet (Rename / Delete checklist, with an `Alert` naming it and its item count);
  - a progress bar animated over `motion.progress`;
  - item rows with a one-tap checkbox (`accessibilityRole="checkbox"`), tap-to-edit text with ×, and done items shown struck through in `textSecondary`;
  - an "＋ Add item" field that adds at the end on Return and stays focused (`blurOnSubmit={false}`).
- In `[taskId]/index.tsx`:
  - a Labels row with chips and Edit/Add, opening `labels/pick`;
  - a "Checklist" heading row with the total progress and "＋ Add";
  - the checklist cards;
  - the empty state with one "＋ Add checklist" button (mockup 2e);
  - move "Edit task" to `headerRight` (a text link with a 44pt touch area);
  - keep the delete button at the bottom.
- In `[taskId]/edit.tsx`: a Labels field opening the same picker (R18).

Depends on: 7, 8, 9
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. By hand (Test Handoff, AC 13, 16, 17, 24 header part): a one-tap tick, adding items in a row with the keyboard open, rename and delete, offline ticking, and Edit and Add reachable without scrolling.

### 11. Appearance setting

- Add `apps/mobile/src/theme/appearance.ts`: `readAppearance(store)` and `writeAppearance(store, choice)`, under the key `appearance.v1`. A missing or unknown value reads as `"system"`. Add `appearance.test.ts` (AC 24).
- In the root `_layout.tsx`, read the stored choice during the existing loading step, before the first screen, and call `Appearance.setColorScheme(choice === "system" ? null : choice)`. Confirm that sign-out cleanup doesn't remove `appearance.v1`.
- Add `apps/mobile/src/ui/AppearancePicker.tsx`, as described in the plan and mockup 5a:
  - three tiles with the Ionicons phone, sun and moon icons;
  - the selected tile with `tile` fill, an `accent` icon and a ✓;
  - `PressableScale`;
  - reanimated icon motion over `motion.progress`;
  - the Settings content fades around the scheme change;
  - with `useReducedMotion`, only the fade.
- Use it in `app/(app)/account.tsx` under Language. Add `settings.appearance.*` strings.

Depends on: none
Verify: `ourkit gate run test` and `ourkit gate run lint` pass. By hand (Test Handoff, AC 24): Dark, Light and System switch the whole app including headers and alerts; the choice is kept after a restart and after sign-out; the animation runs, and only the fade remains with Reduce Motion.

### 12. Final check and Test Handoff notes

- Run the full suite, lint and build.
- Check every Acceptance Criterion is covered by a test or listed for the Test Handoff.
- Run `db:deploy` on the dev database (lesson).
- Note in the change record that phone QA starts with `npm run dev:phone` from this checkout.

Depends on: 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
Verify: `ourkit gate run test`, `ourkit gate run lint` and `ourkit gate run build` pass.
