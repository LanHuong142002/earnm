---
name: ourkit-tasks
description: Breaks the approved plan for the Active Change into small ordered tasks, marking what depends on what. Use after the ourkit Plan Stage, or when asked to write ourkit tasks.
---

# Tasks

Split the plan into tasks small enough to delegate and check one at a time. In these steps, `ourkit <subcommand>` means `node .ourkit/kit/bin/ourkit.js <subcommand>`, run from the project root.

## Before you start

1. Run `ourkit pending`. If it prints anything, mention that line to the user.
2. Run `ourkit gate artifact plan`. If it blocks, go back to Plan.
3. Run `ourkit gate approval`. If it blocks, the user hasn't approved this plan, so go back to Plan.
4. Read the spec and plan at the paths from `ourkit gate path spec` and `ourkit gate path plan`.

## Steps

Write the tasks at the path from `ourkit gate path tasks`, under one `## Tasks` heading:

```markdown
## Tasks

### 1. Short title of the task

What to do, and the files involved, so a subagent with no other context can do it.

Depends on: none
Verify: how to confirm this task worked
```

- **Keep each task small and whole.** One subagent should finish it in one go, with its tests, leaving the project working.
- **State dependencies honestly.** `Depends on:` lists the task numbers that must finish first, or `none`. Tasks with no dependency between them are independent. A Loop Run relies on this to skip a stuck task and carry on with others (ADR 0009), so don't add dependencies just for ordering.
- **Make each one checkable.** `Verify:` says how to confirm it worked, such as a test that passes. Write a check of the project's tests, lint or build as `ourkit gate run <name>`, not as the command itself. If only the user can check it, say so, because it will become part of the Test Handoff.
- **Cover the plan exactly.** Every requirement in the spec should be reached by some task, and no task should add anything the plan doesn't ask for.

Then run `ourkit gate artifact tasks`, and fix any problem it reports.

## Handing over

Continue to Build. Don't write code in this Stage.
