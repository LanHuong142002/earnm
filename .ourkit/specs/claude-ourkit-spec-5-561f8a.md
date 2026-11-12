# Spec: Owners can invite people with a single-use link

Ticket: #5 (Epic F4). Decisions 2 and 3 in `.ourkit/epics/epic-mvp.md`.

## Goal

An Owner can bring a partner into a project by sending a link through Zalo or Messenger from the iOS share sheet. The link opens a small web page served by the API that shows the invite code and how to install the app. That works even before the app is on the App Store. The partner signs up or signs in, enters the code and joins as a Member. Everyone in a project can see who is in it. Owners can promote, demote and remove members, and anyone can leave, but a project is never left without an Owner. Until now, members could only be added through the database, so this turns projects into something friends can actually share.

## Requirements

### Invites

1. Only an Owner of a project can create an invite for it. A Member gets 403 `forbidden`, and a non-member or an unknown project gets 404 `not_found`, matching today's projects routes.
2. Each invite has one code of 8 characters from an alphabet without look-alike characters (no `0`, `O`, `1`, `I`, `L`). It is shown as `XXXX-XXXX`. Entering it ignores case, spaces and dashes.
3. An invite expires 7 days after it was created. It can be used once, by one person, and that person joins as a Member.
4. A project can have several pending invites at once, up to 20. Creating a 21st is refused with 409 `too_many_invites`. Pending means not used, not revoked and not expired.
5. The plain code is returned only in the response that creates the invite. The server keeps only a value it can match a code against, never the code itself. So an Owner can't see an old code again. To re-share, they create a new invite.
6. Any Owner of the project can list its pending invites (who created each, when, and when it expires) and revoke any of them. A revoked invite can't be used. Revoking an invite that's already used, revoked or expired changes nothing and still succeeds.
7. An invite belongs to its project, not to the Owner who created it. It stays valid if that Owner is later demoted or leaves. When an Owner removes a member, every pending invite that member created is revoked in the same change, so a removed person can't get back in with codes they saw. Nobody can join with an invite they created themselves (`invalid_invite`). Deleting the project deletes its invites.
8. The invite link is `<API base URL>/i/<code>`. The app builds it from its configured API URL (`EXPO_PUBLIC_API_URL`), so the server needs no new base-URL setting.

### The invite web page

9. `GET /i/<code>` needs no sign-in and returns an HTML page.
   - **Valid invite:** it shows the project name, the inviter's display name, the code as `XXXX-XXXX`, when it expires, and install steps: install Expo Go; open the app using the install link (see req 11), or ask the person who invited you; sign up or sign in; tap "Join with code" and enter the code.
   - **Unknown, used, revoked or expired code:** it shows one generic page saying the invite is no longer valid and to ask for a new one, with status 404. It never reveals a project name, or which of those reasons applies.
10. The page is in Vietnamese unless the browser's `Accept-Language` prefers English over Vietnamese.
11. If the optional environment variable `INVITE_INSTALL_URL` is set, the install step links to it. If it's unset, that step says to ask the person who invited you. If it's set, it must be an `https://` URL, or the API refuses to start.
12. The page is self-contained: no scripts, no outside resources, every inserted value HTML-escaped. It carries a restrictive Content-Security-Policy, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`.
13. Page lookups are rate-limited per IP, so codes can't be guessed by scanning the page. Over the limit, the request gets 429 and the generic invalid page.

### Joining

14. A signed-in person can join by code. On success they become a Member of the project, the invite is marked used by them, and the response returns the project in the same shape as an item from `GET /projects`.
15. An unknown, used, revoked or expired code returns one error, 404 `invalid_invite`, without saying which.
16. A person who is already a member gets 409 `already_member`, and the invite is **not** used up.
17. A project holds at most 50 members. Joining a full project gets 409 `project_full`, and the invite is not used up.
18. Joining is atomic. If two people use the same code at the same moment, exactly one joins and the other gets `invalid_invite`.
19. Join attempts are rate-limited per account and per IP, so codes can't be guessed. Over the limit, the request gets 429 `too_many_attempts`. The limit reserves the attempt before the code is checked (see Lessons).

### Members

20. Any member can list a project's members: display name, role and when they joined. Owners come first, then members in joining order. Emails are never included. A non-member gets 404.
21. An Owner can make a Member an Owner (promote) and make an Owner a Member (demote), including demoting themselves.
22. An Owner can remove any other member, Owner or Member. Nobody removes themselves this way; they leave instead (req 23).
23. Any member can leave a project.
24. **Never without an Owner:** a demote, remove or leave that would leave the project with no Owner is refused with 409 `last_owner`. The rule holds even when two Owners act at the same moment, for example demoting each other.
25. A Member who tries to promote, demote or remove gets 403 `forbidden`. A target who isn't in the project gets 404 `not_found`.
26. Someone who has been removed or has left loses access at once. Every project route then answers 404 for them, as for any non-member. Their sessions stay valid for their other projects.
27. `GET /projects` reflects role changes. After a promote or demote, the person's `role` for that project changes on their next refresh.

### On the phone

28. Invites, joining and member changes need a connection. They are not put in the offline write queue. Without a connection, the app says it's offline and keeps the screen as it was.
29. **Navigation map** (a stack inside the Home tab, like #4; back and swipe-back always return to the screen before):
    - Project screen → tapping the **avatar row** (any avatar, the `+N` circle or the `+` button; req 29a) → Members screen. Back goes to the Project screen.
    - Members screen (Owner) → **Invite** → creates an invite → iOS share sheet. Closing the share sheet returns to the Members screen.
    - Members screen → tapping a member (Owner only, any member but themselves) → an action sheet with Make Owner or Make Member, and Remove. Remove asks for confirmation.
    - Members screen → **Leave project** (everyone) → confirmation → Project list. The project is gone from the list.
    - Project list → **Join with code** → Join screen → on success, the joined project's screen, which becomes the current project. Back from there goes to the Project list.
29a. **Avatar row on the Project screen:** this replaces a plain "Members" row. From left to right:
    - the first 3 members, in the member-list order (Owners first, then joining order), as round avatars overlapping each other, each with a thin ring in the screen's background colour so the edges stay visible;
    - if the project has more than 3 members, a circle of the same size showing `+N`, where N is the number of members not shown;
    - a `+` circle, shown to everyone.
    Each avatar holds the uppercase first letter of the member's display name, in one neutral fill and text colour for everyone. It's never multicoloured, per `DESIGN.md`, which this change updates to allow single-tone initials avatars. The whole row is one control with an accessible name such as "5 members, open member list". The row uses the last member list loaded for the project. If none has been loaded and the phone is offline, the row is hidden.
    A mockup of the avatar row and the Members screen is shown and approved during Plan, before Build (see Lessons).
30. **Members screen:** lists members with avatar, name and role, and marks the viewer as "You". For Owners, an **Invite** button at the top creates an invite and opens the share sheet (req 29). For Owners, a collapsible **Pending invites** section starts closed (Decision 10) and lists each invite's creator and expiry, with a Revoke action that asks for confirmation.
31. **Share message:** written in the inviter's app language. It contains the inviter's name, the project name, the code as `XXXX-XXXX` and the link.
32. **Join screen:** one code field (ignoring case, spaces and dashes) and a Join button. Each error from reqs 15–17 and 19 shows a clear translated message. The button is disabled while the request is in flight, and while the field holds fewer than 8 code characters.
33. **After losing access:** when the person was removed, their next refresh drops the project and they land on the Project list if they were inside it, as with a deleted project in #4. Queued writes for that project are dropped, without retrying.
34. Last-Owner refusals show a translated message. For a last Owner trying to leave, it says "Make someone else an Owner first". If they're also the only member, it says to delete the project instead.
35. Every new text is in both `en.json` and `vi.json`, and every screen follows `DESIGN.md`.
36. **Account tab profile:** above the language setting, a **Your profile** card shows the signed-in person's display name and email, read-only. The card uses what `GET /me` already returns, and is visible only to that person. Since other members see only the name (req 20), this shows people which name their partners see. Offline, it shows the last known values from the signed-in session. If none are known, it shows nothing rather than an error.

### Data

37. A new invite record holds: project, matchable code value (unique), who created it, created-at, expires-at, used-by, used-at and revoked-at. Deleting the project cascades to it. Deleting the inviting or joining user doesn't delete the invite; that reference becomes empty.
38. The migration only adds. Existing projects and memberships are unchanged.

## Acceptance Criteria

Each check is an API test against the real test database, unless it says otherwise.

- **AC1 (reqs 1, 25):** an Owner creates an invite and gets 201 with a code and an expiry 7 days out. A Member gets 403, and a non-member gets 404.
- **AC2 (req 2):** generated codes use only the allowed alphabet. Joining with lowercase, spaces or dashes succeeds.
- **AC3 (reqs 3, 15):** an invite with an expiry in the past gives `invalid_invite`. A used one gives `invalid_invite` to a second person.
- **AC4 (req 4):** with 20 pending invites, a 21st gets 409 `too_many_invites`. After revoking one, creating succeeds.
- **AC5 (req 5):** the stored invite row doesn't contain the plain code. Listing pending invites returns no code.
- **AC6 (req 6):** an Owner lists pending invites and revokes one, after which joining with it gives `invalid_invite`. Revoking it again gives success. A Member can't list or revoke.
- **AC7 (req 7):** the creating Owner is demoted, and the invite still works. Deleting the project removes its invites. When the creating Owner is removed, their pending invites are revoked (another person's join gives `invalid_invite`) while invites created by others stay pending. A person joining with an invite they created, after leaving, gets `invalid_invite`.
- **AC8 (reqs 9, 12):** the valid-code page returns 200 HTML with the project name, inviter name, formatted code and install steps, and the listed headers. A project name containing `<script>` appears escaped. The unknown, used, revoked and expired cases each return the same 404 body with no project name.
- **AC9 (req 10):** `Accept-Language: en-US,en;q=0.9` gives English. No header, or `vi`, gives Vietnamese.
- **AC10 (req 11):** with `INVITE_INSTALL_URL` set, the page links to it. Unset, the step says to ask the inviter. A non-https value makes config loading fail (unit test).
- **AC11 (reqs 13, 19):** repeated page lookups or join attempts past the limit get 429. Parallel join attempts can't exceed the limit.
- **AC12 (reqs 14, 27):** after joining, the person's `GET /projects` includes the project with role `member`.
- **AC13 (req 16):** an existing member using a code gets 409 `already_member`, and the invite still works for someone else.
- **AC14 (req 17):** with 50 members, joining gets 409 `project_full` and the invite stays pending.
- **AC15 (req 18):** two concurrent joins with one code produce exactly one new member and one `invalid_invite`.
- **AC16 (req 20):** a Member lists members and gets names, roles and join times in the stated order, with no email field. A non-member gets 404.
- **AC17 (reqs 21, 22):** an Owner promotes a Member, demotes another Owner, demotes themselves while another Owner exists, and removes a Member and an Owner. Each change shows in the list.
- **AC18 (req 24):** the sole Owner gets 409 `last_owner` on demoting themselves and on leaving. Removing the only other Owner while the remover stays Owner is allowed. Two Owners demoting each other concurrently leave at least one Owner.
- **AC19 (req 26):** after being removed, the person gets 404 on `PATCH /projects/:id` and on the member list. Their other projects still work.
- **AC20 (req 23):** a Member leaves, and the project disappears from their `GET /projects`.
- **AC21 (req 33, mobile unit test):** a refresh after the project is no longer returned drops it from the cache and drops its queued writes. The routing decision sends the person to the list.
- **AC22 (req 29, QA by hand on iPhone):** each move in the navigation map opens the stated screen, and back and swipe-back return as stated.
- **AC23 (reqs 30–32, 34, QA by hand on iPhone):** the Invite button opens the share sheet with the message in the app language. The code entered in Join opens the project. Each error message appears for its case. Pending invites start collapsed. Members see no manage actions.
- **AC24 (req 28, QA by hand):** with the phone offline, Invite, Join and member actions show the offline message, and nothing is queued.
- **AC28 (req 29a, a mobile unit test plus QA by hand on iPhone):** a pure function gives the row's contents: 1, 3, 4 and 50 members produce 1, 3, 3 and 3 avatars, no `+N`, no `+N`, `+1` and `+47`, and always a final `+`. The initial is the uppercase first letter of the name. On the phone, the avatars overlap with a visible ring, all share one colour, and tapping any part of the row opens the Members screen. A Member sees the same row.
- **AC25 (req 35):** a test checks that `en.json` and `vi.json` have the same keys.
- **AC26 (req 38):** the migration applies to a database that already has projects and members, and they are unchanged.
- **AC27 (req 36, QA by hand on iPhone, plus a mobile unit test for the offline fallback):** the Account tab shows the signed-in person's display name and email above the language setting, with no edit control. After switching accounts it shows the new person's details. Offline, it shows the last known values.

## Out of Scope

- Email invites (deferred, Decision 3).
- The "member joined" push notification (#16).
- Opening the app directly from the link (deep or universal links). Until the app is on the App Store, the link only opens the web page.
- Showing an old invite code again. To re-share, an Owner creates a new invite.
- Transferring ownership as a separate action. Promote, then leave, covers it.
- Viewer role (deferred, Decision 2).
- Cleaning up expired invite rows. They just stop working.
- Rate limits shared across several server processes. The API runs as one Render instance, like the existing sign-in limits.
- Changing which roles may edit project fields. Owner-only stays as in #4.
- Editing the display name or email from the Account tab. The profile card is read-only.

## Open Questions

None.
