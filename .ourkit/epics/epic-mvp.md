# Epic: earnm MVP

earnm helps a small group of friends plan a business together, starting with a drinks shop: tasks with reminders, ideas, and the real cost of each cup. One person can own several projects and be a member of others. The app runs on iPhone through Expo Go; the API is Express + Prisma on PostgreSQL.

## Decisions from the Grill

1. Auth is email + password in the Express API; forgot-password is deferred.
2. Roles are Owner and Member; a project may have several Owners; Viewer is deferred.
3. Invites are single-use links/codes shared through the iOS share sheet, expire after 7 days, can be revoked by an Owner, and join as Member. The link opens a small web page with the code and install steps. Email invites are deferred.
4. Offline level B from the first data feature: cached reads plus queued writes that sync when online; conflicting edits to one record resolve last-write-wins.
5. Reminders belong to tasks: several times per task, recipients default to assignees, repeat once/daily/weekly on chosen days/monthly with an optional end date, push shows title, due date and up to 3 latest "remind with" comments, device timezone, stop when done.
6. A task card has title, description, checklists, assignees, due date, reminders, status (To do / Doing / Done), colour labels, comments and image attachments. Tasks show as one list with filters, not Kanban columns.
7. Images go to Cloudinary through server-signed uploads, compressed on the phone, queued offline, at most 10 per item.
8. Ingredients are measured by weight (g), volume (ml) or portion; conversion only within kg/g and l/ml. Products have S/M/L sizes, each with a recipe, extra costs and a selling price. Ingredients and extra costs can be default and unchecked per product. The price suggestion is a small hint. The last 5 prices of an ingredient are kept.
9. Fixed costs are in MVP and add an equal per-cup share to each product's full cost, using a project-level expected cups per month.
10. Screens are compact vertical flows with collapsible sections that start closed; avoid tables.
11. Ideas have title, description, images, status (New / Considering / Accepted / Dropped), comments, votes and shared labels; an accepted idea can become a task or a product.
12. Language (VI/EN) is per user; currency (VND or USD) is per project, with no exchange conversion.
13. Activity push goes only to people involved, never to the actor, is batched within 1 minute, and can be muted per type or per project; reminders cannot be muted.

Deferred beyond this Epic: forgot-password, Viewer role, email invites, cash flow, capital contributions and profit split, break-even calculator, supplier directory, inventory, bank transfer via QR, widgets and Live Activities, custom columns and calendar view.

## F1 People can create an account and sign in on iPhone

GitHub issue: #2

**Summary:** Email and password sign-up, sign-in and sign-out, with the app's VI/EN language setting.

**User Story:** As a shop partner, I want my own account, so that the app knows which projects and tasks are mine.

**Context:** Every later feature hangs off an account (Decision 1). This is also where the database connection, password hashing, session tokens and the bilingual UI are set up, so later features can reuse them (Decisions 10, 12).

**Scope Boundary:**
- In: sign-up, sign-in, sign-out, staying signed in, VI/EN setting defaulting to the phone's language, the first Prisma schema and migration.
- Out: forgot-password and Sign in with Apple (deferred); projects (F3).

**Links & References:** Decisions 1, 10, 12.

**Blocked by:** none

## F2 The API runs on Render and stays awake

GitHub issue: #3

**Summary:** The API is deployed to Render's free tier with a Neon database, and an outside cron keeps it awake through a protected tick endpoint.

**User Story:** As a shop partner, I want the app's server to answer quickly at any hour, so that reminders arrive on time and the app never waits a minute to wake up.

**Context:** Render's free tier sleeps after 15 minutes idle and allows one always-on service. A cron on cron-job.org calling a secret-protected `POST /internal/tick` every 5 minutes keeps it awake and later drives reminder delivery (F9).

**Scope Boundary:**
- In: Render service, Neon production database, environment variables outside the repo, the tick endpoint with a secret, cron setup steps, deploy and smoke commands in the Stack Profile.
- Out: what the tick does for reminders (F9).

**Links & References:** Decision 5; `docs/roadmap.md`.

**Blocked by:** none

## F3 People can create projects and work on them offline

GitHub issue: #4

**Summary:** A signed-in person can create, rename and delete projects, pick each project's currency, and see every project they belong to, with offline reads and queued writes.

**User Story:** As a shop partner, I want to keep separate projects for each business idea, so that plans for one shop don't mix with another.

**Context:** One person can own several projects and join others. This is the first data feature, so it also builds the offline layer (cached reads, a write queue that syncs when online, last-write-wins) that every later feature uses (Decision 4). The creator becomes an Owner (Decision 2).

**Scope Boundary:**
- In: project list and switcher, create/rename/delete, currency VND or USD with number formatting, the offline cache and write queue.
- Out: inviting people (F4).

**Links & References:** Decisions 2, 4, 12.

**Blocked by:** F1

## F4 Owners can invite people with a single-use link

GitHub issue: #5

**Summary:** An Owner shares a single-use, 7-day invite through the iOS share sheet; the person joins as Member, and Owners can manage members.

**User Story:** As a project Owner, I want to send an invite through Zalo or Messenger, so that my partner can join even before installing the app.

**Context:** Until the app is on the App Store, a link can't open the app directly, so it opens a small web page served by the API showing the code and install steps (Decision 3). Joining is an auth and permissions change.

**Scope Boundary:**
- In: create and revoke invites, share sheet, invite web page, join by code, member list, promote to Owner, remove a member, leave a project, never leaving a project without an Owner.
- Out: email invites (deferred); the "member joined" push (F15).

**Links & References:** Decisions 2, 3.

**Blocked by:** F3

## F5 Members can track tasks in a simple list

GitHub issue: #6

**Summary:** Tasks with title, description, status, assignees and due date, shown as one list with status, "my tasks" and "due soon" filters.

**User Story:** As a shop partner, I want to see who is doing what and by when, so that nothing we planned gets forgotten.

**Context:** Tasks show as a single list rather than Kanban columns, which are hard to read on a phone (Decision 6). Reminders, comments, checklists and images attach to tasks in later features.

**Scope Boundary:**
- In: create, edit and delete tasks; status To do / Doing / Done; several assignees; due date; list with filters; works offline.
- Out: checklists and labels (F6), comments (F7), images (F8), reminders (F9).

**Links & References:** Decisions 6, 10.

**Blocked by:** F3

## F6 Tasks can have checklists and colour labels

GitHub issue: #7

**Summary:** A task can hold several named checklists with progress, and colour labels shared across the project.

**User Story:** As a shop partner, I want to break a task into steps and group tasks by label, so that I can see progress at a glance.

**Context:** Labels are shared with ideas (F10), so they belong to the project, not to one task (Decisions 6, 11).

**Scope Boundary:**
- In: checklists with items and an `x/y` progress, project labels with colours, assigning labels, filtering by label.
- Out: labels on ideas (F10).

**Links & References:** Decisions 6, 11.

**Blocked by:** F5

## F7 Members can comment on tasks

GitHub issue: #8

**Summary:** Members can comment on a task and mark a comment "remind with" so it travels with the task's reminders.

**User Story:** As a shop partner, I want to leave notes on a task, so that whoever does it knows the details when they're reminded.

**Context:** Up to 3 latest "remind with" comments appear in reminder push notifications (Decision 5).

**Scope Boundary:**
- In: add, edit and delete own comments; the "remind with" flag; works offline.
- Out: sending reminders (F9); comment push notifications (F15).

**Links & References:** Decision 5.

**Blocked by:** F5

## F8 Members can attach photos to tasks

GitHub issue: #9

**Summary:** Up to 10 photos per task, compressed on the phone and uploaded to Cloudinary through server-signed uploads, queued while offline.

**User Story:** As a shop partner, I want to attach photos such as receipts or cup samples to a task, so that we both see the same thing.

**Context:** The Cloudinary secret stays on the server; only project members can see a project's images (Decision 7). Ideas reuse this in F10.

**Scope Boundary:**
- In: pick from camera or library, compression, signed upload, thumbnails, delete, offline queue, the 10-photo limit.
- Out: images on ideas (F10); other file types.

**Links & References:** Decision 7.

**Blocked by:** F5

## F9 Assignees are reminded about tasks by push notification

GitHub issue: #10

**Summary:** Tasks can have several one-off or repeating reminders that arrive as push notifications on the lock screen and in Notification Center.

**User Story:** As a shop partner, I want my phone to remind me about tasks, so that I don't forget to buy supplies or meet the landlord.

**Context:** Reminders fire on time as local notifications rescheduled on each sync, while the server sends a push when a reminder or "remind with" comment changes and catches missed ones on each tick (Decision 5, F2).

**Scope Boundary:**
- In: notification permission and push token registration; reminder times; once, daily, weekly on chosen days, monthly, optional end date; recipients defaulting to assignees; push content with "remind with" comments; tapping opens the task; stop when done.
- Out: snooze, widgets and Live Activities (deferred); activity push (F15).

**Links & References:** Decisions 5, 13.

**Blocked by:** F2, F7

## F10 Members can collect, discuss and vote on ideas

GitHub issue: #11

**Summary:** An ideas board with title, description, photos, status, comments, votes and labels; an accepted idea can become a task.

**User Story:** As a shop partner, I want to write down and vote on ideas, so that we decide together what to try next.

**Context:** Ideas reuse project labels (F6) and photo upload (F8). Turning an idea into a product is F14, because products arrive in F12 (Decision 11).

**Scope Boundary:**
- In: create, edit and delete ideas; status New / Considering / Accepted / Dropped, with Dropped collapsed; comments; up/down votes; labels; photos; "create task" from an accepted idea.
- Out: "create product" from an idea (F14); new-idea push (F15).

**Links & References:** Decision 11.

**Blocked by:** F6, F8

## F11 Members can record ingredients and their unit cost

GitHub issue: #12

**Summary:** An ingredients list with what was bought and for how much, giving a unit cost per gram, millilitre or portion, plus the total spent.

**User Story:** As a shop partner, I want to enter what I paid for supplies once, so that the app works out what each gram or portion costs.

**Context:** Each ingredient is measured by weight, volume or portion, and the form shows only the fields for the chosen mode; conversion stays within kg/g and l/ml (Decisions 8, 10).

**Scope Boundary:**
- In: create, edit and delete ingredients; weight, volume and portion modes; unit cost per 1 and per 10 units; total spent at the top; "default" flag; keeping the last 5 prices.
- Out: using ingredients in products (F12); inventory (deferred).

**Links & References:** Decisions 8, 10.

**Blocked by:** F3

## F12 Members can build products and see the cost of each cup

GitHub issue: #13

**Summary:** Products with S/M/L sizes, each with ingredients, extra costs and a selling price, showing cost, profit per cup and a small price hint.

**User Story:** As a shop partner, I want to see what each drink costs to make, so that we can set prices that make a profit.

**Context:** Default ingredients and extra costs prefill new products and can be unchecked. Cost updates when an ingredient's price changes. The price hint stays a small, quiet line (Decisions 8, 10).

**Scope Boundary:**
- In: create, edit and delete products and sizes; recipe lines; extra costs such as ice and water; defaults; selling price; profit and margin; price hint for a target margin.
- Out: fixed costs in the cost (F13); creating a product from an idea (F14).

**Links & References:** Decisions 8, 10.

**Blocked by:** F11

## F13 Fixed costs are shared across the price of each cup

GitHub issue: #14

**Summary:** A fixed costs area (rent, staff, equipment) whose monthly total, divided by expected cups per month, is added to each product's full cost.

**User Story:** As a shop partner, I want rent and wages included in each cup's cost, so that our prices cover the whole business, not just ingredients.

**Context:** Items are monthly, weekly or one-time spread over N months. The section starts collapsed, showing only the monthly total. Profit and the price hint switch to the full cost (Decisions 9, 10).

**Scope Boundary:**
- In: fixed cost items; project-level expected cups per month; per-cup share and full cost on each product.
- Out: break-even calculator and cash flow (deferred).

**Links & References:** Decisions 9, 10.

**Blocked by:** F12

## F14 An accepted idea can become a product

GitHub issue: #15

**Summary:** From an accepted idea, a member can create a product prefilled with the idea's title and linked back to it.

**User Story:** As a shop partner, I want to turn an agreed drink idea straight into a product, so that we can cost it right away.

**Context:** Split from F10 so the ideas board doesn't wait for products (Decision 11).

**Scope Boundary:**
- In: "create product" on accepted ideas, the link between idea and product.
- Out: everything else about ideas (F10) and products (F12).

**Links & References:** Decision 11.

**Blocked by:** F10, F12

## F15 Members get push notifications for project activity

GitHub issue: #16

**Summary:** Push notifications for assignments, new comments, finished tasks, new ideas and new members, batched and mutable per type or project.

**User Story:** As a shop partner, I want to hear when something involving me changes, so that I can react without opening the app all day.

**Context:** Pushes go only to people involved and never to the person who acted; bursts within a minute are batched; reminders can't be muted (Decision 13).

**Scope Boundary:**
- In: the five activity events, batching, per-type and per-project mute settings.
- Out: reminders (F9); ingredient price changes, which stay in-app only.

**Links & References:** Decision 13.

**Blocked by:** F4, F7, F9, F10
