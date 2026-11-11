# Spec: People can create projects and work on them offline

Ticket: #4 (Epic F3). Tier: Feature. Sensitive Areas: data, schema, public API.

## Goal

A signed-in shop partner can keep a separate project for each business idea: create one, rename it, describe it, set its currency (VND or USD), delete it, see every project they belong to and switch between them. All of this keeps working without a connection: the phone shows what it last loaded, records changes made offline, and sends them when it is back online, with conflicting edits resolved last-write-wins per field.

This matters because projects are the container every later feature (tasks, ideas, products, costs) lives in, and because this ticket builds the offline layer those features reuse (Epic Decision 4). The creator of a project becomes its Owner (Decision 2), and currency is set per project with no conversion (Decision 12).

Today the API has accounts and sessions only (`User`, `Session`), and the mobile app has no local data storage beyond the session token and language choice in secure storage. The only offline write in the app is the language choice, synced through a single pending flag.

## Requirements

### Projects and membership

1. A project has a name, an optional description and a currency. A name is trimmed and must be 1 to 80 characters. A description is trimmed, may be empty, and is at most 500 characters. Currency is `VND` or `USD`.
2. A person can belong to many projects, and a project can have many people. Each membership has a role, Owner or Member. A person belongs to a project at most once.
3. A signed-in person can create a project by giving a name, a currency and optionally a description. They become its Owner. No other members can be added in this feature.
4. A project's id is chosen by the phone when the project is created (a UUID), so a project created offline keeps the same id once it reaches the server.
5. Creating a project is idempotent: sending the same create again with the same id returns the existing project and doesn't create a second one. If that id already belongs to a project the person isn't a member of, the request is refused.
6. A signed-in person can list every project they belong to, with each project's name, description, currency and their own role. Projects they don't belong to never appear. The list is the only way to read projects; there is no endpoint for reading a single project. (Settled at Review.)
7. Only an Owner can change a project's name, description or currency. A change can include any subset of those fields.
8. Changing the currency changes only how amounts are labelled and formatted. No stored amount is converted.
9. Only an Owner can delete a project. Deleting it removes the project and its memberships permanently (hard delete). There is no undo or trash.
10. For any project the person doesn't belong to, or that doesn't exist, changing or deleting it gives a "not found" error, so the response doesn't reveal whether the project exists. A Member who tries to change or delete a project gives a "not allowed" error.
11. Every projects endpoint requires a signed-in person, and refuses a missing, unknown or expired session with the existing "not signed in" error. Errors use the existing API error shape.

### Conflicts (last-write-wins per field)

12. Every change to a project field carries the time the person made it on the phone (`editedAt`). The server keeps, for each field, the time of the change it last accepted.
13. The server accepts a change to a field only if its `editedAt` is later than the stored time for that field; otherwise it keeps the stored value. Fields are judged separately: two people editing different fields of one project both keep their changes.
14. An `editedAt` later than the server's current time is treated as the server's current time, so a phone with a wrong clock can't win every conflict.
15. After any change request, the server responds with the project as it now is, whether or not each field was accepted.

### Currency formatting

16. Amounts are formatted by the project's currency: VND with no decimals and `.` as the thousands separator, followed by `₫` (`1.250.000 ₫`); USD with two decimals, `,` as the thousands separator and a leading `$` (`$1,250.50`). The format depends on the currency, not on the app language. This formatter is shared so later features use it; this feature only shows the currency on the project screens.

### On the phone: reading

17. The phone keeps a local copy of the person's project list. On launch, and whenever the project list is shown, it shows the local copy at once, then refreshes it from the server when online.
18. Offline, the project list, the current project and its details stay visible from the local copy, with a note that the phone is offline.
19. A refresh replaces the local copy with the server's list. Changes still waiting to be sent are then reapplied on top, so the screen never loses a change the person made offline. A project deleted on the server disappears from the phone at its next refresh.
20. The local copy and the waiting changes survive closing and reopening the app.

### On the phone: writing

21. Creating, editing or deleting a project shows the result on screen immediately, online or offline, and records the change in a single write queue on the phone.
22. The queue is shared: it holds changes from any feature, not only projects, so later features add their kinds of change without rewriting the sending, retrying or merging. Every kind of change in the queue has a known way to be sent; a kind with none can't be added.
23. Changes to the same project that haven't been sent yet are merged: editing a field twice leaves one change with the latest value; creating then editing leaves one create with the latest values; creating then deleting before sending leaves nothing to send.
24. The phone sends the queue in the order the changes were made: right after a change, when the app opens, when it returns to the foreground, and when the connection comes back. It sends again changes whose sending failed for lack of connection, and sends each change at most once at a time.
25. When the server accepts a change, or answers with the project's current state after a conflict, the phone takes the server's version and removes the change from the queue.
26. When the server refuses a change for good ("not allowed", "not found" or invalid input), the phone removes it from the queue, puts back the server's version of that project (or removes the project if it no longer exists), and tells the person their change couldn't be saved.
27. When the server answers "not signed in", the queue is kept unchanged and the app returns to the sign-in screen, as it does today. Changes are sent once the same person signs in again.
28. Signing out removes the local project copy, the queue and the remembered current project from the phone, so the next person to sign in on it sees none of them. If changes are still waiting to be sent, the app warns before signing out that they will be lost.

### On the phone: screens

29. **Screens.** The signed-in part of the app has a tab bar at the bottom with two tabs, Home and Account (Account holds what Settings holds today). The Home tab contains Home, Project list, Project (one project's details), New project and Edit project. Home is the starting point for the app's areas and shows, from top to bottom (Rewritten at QA, following the user's reference design):
   - a card for the current project (the one used last on this phone), showing its name and currency, that opens it; with no project, the card invites the person to create their first project;
   - a grid of area tiles, one per area, each with an icon and a label: Projects, which opens the Project list, and Ideas and Shared schedule, which aren't built yet, look disabled, are labelled "Coming soon" and do nothing when tapped.
29a. **How they connect.** Each move below opens the next screen on top of the current one, so going back returns to where the person was:
   - After sign-in or sign-up, and on every launch while signed in: Home. Going back from Home never returns to the sign-in screens.
   - Home → the current project card → Project. Home → the Projects tile → Project list. The Account tab → Account (settings); switching tabs keeps each tab where the person left it.
   - Project list → a project → Project (that project also becomes the current one). Project list → "New project" → New project.
   - New project → create → Project for the new project, which becomes current; going back from it returns to the Project list (or Home, if creation started there), not to the filled-in form.
   - Project → "Edit" (Owners only) → Edit project. Saving returns to Project, showing the saved values.
   - Edit project → delete → confirm → Project list, without the deleted project; going back from there doesn't reach the deleted project's screens.
   - Project → "Switch project" → Project list.
   - Account → sign out → Sign in.
   - If the project being viewed disappears (deleted elsewhere, or a change to it is refused with "not found"), the person is taken to the Project list, which shows the "couldn't be saved" notice when there was one.
29b. **Going back.** Every screen except Home and Account can be left by the header's back control and by the system back gesture (on iPhone, swiping from the left edge), both returning to the previous screen in 29a. No move leaves a duplicate screen behind it, so going back never shows the same screen twice in a row. (Added at QA.)
30. A person with no projects sees an invitation to create their first project, in Home's current-project card and on the Project list.
31. The person can switch between their projects from the Project list, and the choice is remembered on the phone and shown on Home.
32. Create and edit forms validate the same limits as the server before saving, and show a clear message per field. Only an Owner sees the controls to edit or delete. Deleting asks for confirmation, naming the project, and says it can't be undone. While typing, the keyboard's return key moves to the next field and, on the last field, submits the form, and the submit button is never hidden behind the keyboard. (Keyboard part added at QA.)
33. Screens follow Decision 10 (compact vertical flows, collapsible sections starting closed, no tables), and all text is available in Vietnamese and English.

### Data

34. A database migration adds the projects and memberships tables. Deleting a user or a project removes their memberships.

## Acceptance Criteria

1. API tests: names of 0 and 81 characters after trimming, a description of 501 characters, and a currency other than `VND`/`USD` are refused with `validation_failed`; a name of 80 characters, an empty description and both currencies are accepted.
2. Schema check: a membership table has a role of Owner or Member and a unique (project, user) pair; a test inserting the same pair twice fails.
3. API test: creating a project returns it with the caller's role as Owner, and a membership row exists for the caller as Owner. The create request has no members field; one sent is refused as invalid.
4. API test: a project created with a phone-chosen UUID is stored and returned with that same id.
5. API tests: sending the same create twice returns the same project both times and leaves exactly one project; a create using the id of another person's project is refused and doesn't change that project.
6. API test: with two people and three projects, each person's list contains exactly the projects they belong to, with their role.
7. API tests: an Owner can change name only, description only, currency only, and all three; a Member's change is refused with `403`.
8. API test: changing currency from VND to USD leaves every other stored value unchanged. (By hand: no amount is recalculated anywhere.)
9. API tests: an Owner's delete removes the project and its memberships, and the project no longer appears in any member's list; a Member's delete is refused with `403`; a second delete of the same project gives `404`.
10. API tests: changing and deleting a project that doesn't exist, and one the caller isn't a member of, all give `404` with the same body.
11. API test: every projects endpoint without a token, and with an expired one, gives `401 not_signed_in` in the standard error shape.
12. API test: after an accepted change, the stored time for that field equals the change's `editedAt`, and other fields' times are unchanged.
13. API tests: a change to `name` older than the stored `name` time is ignored; a change to `name` with an older time than a recent `description` change is accepted and the description is kept.
14. API test, with a fixed server clock: a change with `editedAt` one day in the future is stored with the server's current time, and a later real change wins over it.
15. API test: a change that is fully ignored by a conflict returns `200` with the project's current values.
16. Unit tests: `1250000` in VND formats as `1.250.000 ₫` and `1250.5` in USD as `$1,250.50`, in both app languages; `0` formats as `0 ₫` and `$0.00`.
17. By hand: with projects loaded, close the app, turn on airplane mode and reopen it: the list appears straight away. Turn the connection back on: the list refreshes without the person doing anything.
18. By hand: in airplane mode the project list and current project are visible with the offline note.
19. Test of the phone's sync layer: with a waiting rename for project A, a refresh that returns the old name still shows the new name; a refresh without project B removes B.
20. By hand: make a change in airplane mode, force-quit the app, reopen it: the change is still shown and is sent once online.
21. By hand: create, rename and delete a project in airplane mode; each shows on screen at once.
22. Code check plus test: the queue code has no reference to projects; the project kinds of change are registered from the projects code; adding a kind without a way to send it fails the type check or a test.
23. Tests of the queue: two renames give one waiting change with the last name; create then rename gives one create with the new name; create then delete gives an empty queue and no request is sent.
24. Tests of the queue: changes are sent in the order made; a send that fails for lack of connection stays in the queue and is retried on the next trigger; triggering a send while one is running doesn't send any change twice.
25. Test of the queue: after the server accepts a change, the queue is empty and the local copy matches the server's response.
26. Test of the queue: a change answered with `403` or `404` is removed, the local copy shows the server's version (or no project for `404`), and the person sees a "couldn't be saved" message.
27. Test of the queue: a change answered with `401` stays in the queue and the app shows the sign-in screen; after signing in as the same person, it is sent.
28. By hand: sign out and sign in as a different person: none of the first person's projects show. With a change waiting (airplane mode), signing out shows the warning first.
29. By hand: sign in and reopen the app: Home opens with the tab bar (Home, Account), the current-project card and the area tiles; Ideas and Shared schedule show "Coming soon" and do nothing when tapped; back from Home doesn't return to Sign in. With a current project, the card shows it and tapping it opens that project; after that project is deleted from another phone and the app refreshes, Home shows no current project and still offers the project list.
29a. By hand, following each move listed in requirement 29a: the named screen opens, and going back returns to the screen it was opened from. After creating a project, going back from its screen reaches the list (or Home), not the form; after deleting, going back doesn't reach the deleted project.
29b. By hand: on every screen except Home and Account, both the header back control and swiping from the left edge go to the previous screen; walking Home → list → project → edit and back again never shows a screen twice in a row.
30. By hand: a new account sees the invitation to create a project in Home's card and on the Project list.
31. By hand: pick another project from the list, close and reopen the app: Home shows the picked project as current.
32. By hand: an over-long name shows the field message without saving; a Member sees no edit or delete controls (set up through the database, since inviting is #5); delete asks for confirmation naming the project; on create and edit, the return key moves name → description and submits from the last field, and the submit button stays visible above the keyboard.
33. By hand, in both languages: every new screen has no untranslated text and follows Decision 10.
34. The migration applies cleanly to an empty database and to one with existing users; deleting a user in a test removes their memberships.

## Out of Scope

- Inviting people, joining a project and managing members, including adding, removing or changing a member's role (#5). Members only exist through the database in this feature, for testing.
- Leaving a project, and transferring or removing the last Owner.
- Undo, a trash or restoring a deleted project; soft delete. A hard delete is enough while the phone always fetches the whole project list. Incremental sync and soft delete are for later, larger data such as tasks.
- Paging the project list. A person is expected to have at most a few dozen projects.
- Real-time updates pushed from the server: other people's changes appear at the next refresh.
- Any money amounts, prices or costs, and any currency conversion. Only the formatter is built here.
- Activity notifications about project changes (Decision 13).
- Showing a conflict to the person: last-write-wins resolves it silently.

## Open Questions

None.
