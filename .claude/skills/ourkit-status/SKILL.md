---
name: ourkit-status
description: Tells the user where the current change stands, what's done, what's waiting for them and what to run next, from one cheap command. Use when the user asks where they are, what's next, what's done, or says they're lost.
---

# Status

Answer "where am I and what now?" quickly and cheaply. In these steps, `ourkit <subcommand>` means `node .ourkit/kit/bin/ourkit.js <subcommand>`, run from the project root.

1. Run `ourkit status`. It prints everything you need as JSON, so don't read the spec, plan or other files unless the user asks for detail. That keeps this cheap.
2. Reply in a few short lines:
   - **The change:** its name, size (Tier), Pair or Hands-off, and the ticket if there is one. Mention any risky areas it touches (`sensitiveAreas`).
   - **Progress:** one line per step from `stages`, marked ✅ done, 🔨 current or ⬜ to do. For Build, add `tasks` as done out of total.
   - **Waiting on the user:** each item in `waiting` and `pending`, in plain words. Say "nothing" if both are empty.
3. End with the Next line (`.ourkit/kit/core/next-step.md`), built from `next`: the skill to run, or the action that's the user's, and whether it waits for them.

If `change` is null, say no change is in progress on this branch, list `unfinishedBranches` if there are any, and suggest switching to one or describing a new change.

If `installed` is false, say ourkit isn't installed in this project and point to the Installer.

If `statusLine` is `off`, add one line at the end: the user can keep this visible at no cost with `ourkit statusline on`.

Don't change anything in this Stage.
