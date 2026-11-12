# Spec: Tasks can have checklists and colour labels

Ticket: #7 (Epic F6). Tier: Feature. Sensitive Areas: data, schema, public API.

## Goal

A task can be broken into steps: it holds several named checklists, each with items that are ticked off, and shows its progress as `x/y` on the task card and per checklist on the task. A project has its own set of colour labels, which members create once and put on any of the project's tasks, and the task list can be filtered by label. Everything works offline the same way tasks do (#6).

This matters because shop partners need to see at a glance how far a task has got and to group related tasks (Epic Decision 6). Labels belong to the project, not to a task, because ideas will share them later (#11, Decision 11); this feature builds them so #11 can reuse them as they are.

Today (after #6) a task has a title, description, status, assignees and a due date. Each field has its own `<field>EditedAt` time for last-write-wins (`apps/api/src/http/last-write-wins.ts`), and assignees are one set-valued field replaced as a whole. The tasks API is `apps/api/src/tasks/routes.ts`, mounted at `/projects/:projectId/tasks`. Any member can edit any task; only the creator or an Owner can delete one. On the phone, `apps/mobile/src/tasks/` holds the task cache, sync, outcomes and the client-side filters (`filters.ts`, `FilterBar.tsx`), on top of the shared queue in `apps/mobile/src/sync/`. `DESIGN.md` and `apps/mobile/src/theme/tokens.ts` have one accent colour and no palette for categories, and `DESIGN.md` rules out a second accent colour and colour as the only sign of meaning.

## Requirements

### Checklists

1. A task has zero or more checklists, at most 10. A checklist has a name (trimmed, 1 to 60 characters) and zero or more items, at most 50. An item has text (trimmed, 1 to 200 characters) and is either done or not done, starting not done. Names and item text contain no control characters, the same as task titles.
2. Checklists on a task, and items in a checklist, keep the order they were created in. They can't be reordered.
3. Any member of the project, Owner or Member, can add, rename and delete a checklist on any of its tasks, and add, edit, tick, untick and delete any item. Deleting a checklist deletes its items. Deleting a task deletes its checklists and items.
4. Checklists and items get their ids from the phone (UUIDs) when created, so ones created offline keep their ids. Creating is idempotent, as for tasks: sending the same create again returns what exists; an id already used by a checklist or item elsewhere is refused.
5. A task's progress is the number of done items over the number of items, across all its checklists (`x/y`). Each checklist also has its own progress. A task with no items has no progress.

### Labels

6. A project has zero or more labels, at most 50. A label has a name (trimmed, 1 to 30 characters, no control characters) and one colour from a fixed palette of 8 colours, with the keys `gray`, `red`, `orange`, `yellow`, `green`, `teal`, `blue` and `purple`. Two labels in a project can't have the same name, ignoring case and surrounding spaces; the server refuses a duplicate with a clear error.
7. Any member of the project can create a label, rename it and change its colour. Only an Owner can delete a label; anyone else gets a "not allowed" error. Deleting a label removes it from every task. Deleting a project removes its labels.
8. A task carries zero or more of its project's labels, at most 10, each at most once. Any member can change a task's labels. A label from another project, or one that doesn't exist, is refused as invalid. Labels get their ids from the phone (UUIDs), so one created offline can be put on a task offline.
9. A signed-in member can read the project's labels (id, name, colour). Reading the project's tasks also returns, for each task, its label ids and its checklists with their items, in creation order.

### Permissions, errors and conflicts

10. Every new or changed endpoint requires a signed-in person, gives the existing "not found" error for a project the caller isn't in, a project that doesn't exist, or a task, checklist, item or label that doesn't exist or belongs elsewhere, and uses the existing API error shape.
11. Last-write-wins per field, as for tasks: a checklist's name; an item's text and its done state, separately; a label's name and its colour, separately; and a task's labels as one whole set. Each change carries the time it was made on the phone; the server accepts it only if that time is later than the stored one, caps a future time at the server's time, and responds with the current state either way.
12. A delete always wins: a change to a checklist, item or label that has been deleted is refused with "not found".

### On the phone: offline

13. Labels, checklists, items and task labels are kept in the local copy with the tasks, shown at once from it, refreshed with the task list, and readable offline with the existing offline note.
14. Every change in this feature shows at once, online or offline, goes through the shared write queue with the same triggers, order, retry, refusal, "not signed in" and sign-out handling as task changes, and is merged per thing changed (two edits leave one; create then edit leaves one create; create then delete leaves nothing). The shared queue code gains no reference to checklists or labels.
15. A refused change is removed, the local copy is put back to the server's version (or the thing is removed if it no longer exists), and the person is told the change couldn't be saved. A label refused for a duplicate name is removed from the local copy, along with the waiting changes that put it on tasks.

### On the phone: screens

16. **Task card.** The card in the task list also shows the task's labels as chips with name and colour (at most three, then `+n`) and, when the task has items, its progress as `x/y` in words and numbers, not only a bar.
17. **Task details.** The Task screen shows the task's labels and its checklists. Each checklist shows its name, its own progress and its items. An item is ticked or unticked with one tap, without opening a form. From the Task screen a person can add a checklist, rename or delete one (with a confirmation naming it), add an item at the end of a checklist with the keyboard staying open for the next item, and edit or delete an item. (Changed at the mockup review:) Adding a checklist and editing the task are reachable without scrolling past the checklists: "Edit" sits in the header's right side, and "Add" sits at the right of the Checklist section heading. The header shows only the back chevron, with no text beside it, and the screen title centred, like the app's other screens.
18. **Picking labels.** On the Task screen and in the Edit task form, a label field opens a picker listing the project's labels; tapping one adds or removes it from the task. The picker offers "New label" (name and colour) and a way to manage labels.
19. **Managing labels.** A Labels screen, reached from the picker, lists the project's labels. Any member can create, rename and recolour from it; Owners also see delete, which asks for confirmation, names the label, and says it will be removed from every task. Back returns to where it was opened from.
20. **Filter by label.** The filter bar gains a label filter: choose one or more labels, and the list shows tasks carrying at least one of them. It combines with the existing status, "Assigned to me", "Only me" and "Due soon" filters (all must hold), is remembered per project until sign-out like the others, clears with them, and forgets a label that has been deleted.
21. **Colours.** The 8 label colours are added to `DESIGN.md` and the theme tokens as soft, muted tints, each readable in light and dark mode with the label's name on it at normal-text contrast (4.5:1). A label always shows its name, so colour is never the only sign. Labels don't use the accent colour.
22. **Look and language.** Screens follow `DESIGN.md` and Decision 10, and all new text is in Vietnamese and English.

### Appearance (added at the mockup review)

24. The Settings screen gains an "Appearance" section, under Language, with three choices: System (the default), Light and Dark, shown as three tiles side by side, each with an icon (phone, sun, moon) and its name; the selected tile is highlighted and shows a ✓, so colour is never the only sign. Tapping a tile presses it, the selected icon turns or lifts slightly, and the screen's colours change smoothly rather than snapping; with Reduce Motion on, only the colour change fades. Choosing one changes every screen at once, including native headers, sheets and alerts. The choice is kept on the phone and stays after closing the app and after signing out; it isn't saved to the account.

### Data

23. A database migration adds checklists, checklist items, labels and task labels, with the cascades in requirements 3, 7 and 8. It applies to a database that already has users, projects and tasks, and leaves existing tasks with no checklists and no labels.

## Acceptance Criteria

1. API tests: checklist name and item text of 0 and over the limit after trimming, or with control characters, are refused with `validation_failed`; 60 and 200 characters are accepted; an 11th checklist on a task and a 51st item in a checklist are refused with a clear error; a new item is not done.
2. API test: checklists and items are returned in creation order, whatever order they were last edited in.
3. API tests: a Member can add, rename and delete a checklist and add, edit, tick and delete items on a task created by the Owner; deleting a checklist removes its items; deleting the task removes its checklists and items.
4. API tests: a checklist and an item created with phone-chosen UUIDs keep them; sending the same create twice leaves one; reusing an id from another task is refused and doesn't change the original.
5. Unit test of progress: 0 items gives no progress; items across two checklists with 3 of 7 done give `3/7` for the task and the right count per checklist.
6. API tests: label names of 0 and 31 characters, an unknown colour key, and a 51st label are refused; a name equal to an existing one apart from case and spaces is refused with a clear duplicate error.
7. API tests: a Member can create, rename and recolour a label; a Member deleting one gets `403`; an Owner deleting one removes it from every task that had it; deleting a project removes its labels.
8. API tests: putting a label on a task works; a label from another project, an unknown label id, the same label twice, or an 11th label are refused with `validation_failed`.
9. API test: reading tasks returns each task's label ids and checklists with items in order; reading labels returns id, name and colour for that project only.
10. API tests: every new or changed endpoint without a token, or with an expired one, gives `401 not_signed_in`; a project the caller isn't in, and a checklist, item or label from another task or project, give `404` with the same body.
11. API tests: an older change to an item's done state is ignored while a newer change to its text in the same request is accepted; the same for a label's colour and name; a future time is stored as the server's time; a task's labels are replaced as a whole set by the newer change; an ignored change returns `200` with the current state.
12. API test: a change to a deleted item, checklist or label gives `404`.
13. By hand: open a task with checklists and labels, turn on airplane mode, close and reopen the app: the task card and details show them with the offline note.
14. Tests of the queue: two ticks of the same item leave one waiting change; creating then editing a checklist leaves one create; creating then deleting an item sends nothing. Code check: the shared queue code has no reference to checklists or labels. By hand: in airplane mode, create a label, put it on a task, add a checklist and tick an item; reconnect and see all of it on a second phone or in the API.
15. Tests of the outcomes: a refused checklist or item change puts back the server's version (or removes it on `404`) and shows the "couldn't be saved" message; a label refused as a duplicate disappears from the local copy and from the task it was put on.
16. By hand: a card shows up to three label chips then `+n`, and `x/y` only when the task has items.
17. By hand: tick and untick an item with one tap and see both progress counts change at once; add several items in a row with the keyboard staying open; rename and delete a checklist, with the delete confirmation naming it.
18. By hand: the label picker adds and removes labels on a task, and "New label" creates one and puts it on the task.
19. By hand: as a Member, the Labels screen offers create, rename and recolour but no delete; as an Owner, delete asks for confirmation naming the label and the label disappears from its tasks.
20. Unit tests of the filters: one label, two labels (a task with either matches), and a label combined with a status and "Assigned to me" select the right tasks; a remembered deleted label is ignored. By hand: the label choice survives closing and reopening the app and clears with the other filters.
21. By hand, in light and dark mode: all 8 label colours show their names readably, and no label uses the accent colour. Check: each colour's text contrast is at least 4.5:1.
22. By hand, in both languages: no untranslated text, and the new screens follow `DESIGN.md` and Decision 10.
23. The migration applies cleanly to an empty database and to one with existing users, projects and tasks.
24. Unit test of the stored appearance choice: a missing or unknown stored value reads as System. By hand: choosing Dark with the phone in light mode turns every screen, header, sheet and alert dark at once; System follows the phone again; the choice survives closing the app and signing out; the Task screen shows "Edit" in the header and "Add" beside the Checklist heading without scrolling.

## Out of Scope

- Labels on ideas (#11). Labels are built so #11 can reuse them, but nothing here touches ideas.
- Reordering checklists or items, moving an item between checklists, converting an item into a task, assigning or giving due dates to items.
- Colours outside the fixed palette, and label icons.
- Filtering by checklist progress, and showing labels or progress anywhere other than the task list and the Task screen (for example on the Project screen's Tasks tile).
- Merging concurrent changes to a task's labels: the set is one field, so two people changing it at once keep only the later set.
- Saving the appearance choice to the account or syncing it between phones.
- Comments (#8), photos (#9), reminders and push (#10, #16), and real-time updates from the server.

## Open Questions

None.
