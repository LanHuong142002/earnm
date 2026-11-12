---
name: ourkit-build
description: Implements the Active Change with code and tests through subagents, using commands from the Stack Profile. Use after the ourkit Tasks Stage, for a Patch, or when asked to run ourkit build.
---

# Build

Turn the approved tasks into working, tested code. You coordinate and judge; subagents do the implementing and the running (`.ourkit/kit/core/models.md`). In these steps, `ourkit <subcommand>` means `node .ourkit/kit/bin/ourkit.js <subcommand>`, run from the project root.

## Before you start

1. Run `ourkit pending`. If it prints anything, mention that line to the user.
2. Run `ourkit tier show`. If there's no Tier, follow `.ourkit/kit/core/tier.md` first.
3. Run `ourkit mode`, and follow `.ourkit/kit/core/mode.md` for how to ask and decide.
4. Run `ourkit rules`, and give what applies to each subagent you start.
5. Check the Stages from `tier show`, then follow **Feature** or **Patch** below.

## Feature

1. Run `ourkit gate approval` and `ourkit gate artifact tasks`. If either blocks, go back to the Stage that owns it. Never start Build around a blocked Gate.
2. Make sure the change is on its own branch, not the default branch. Create one if needed.
3. Run `ourkit task list`. For each task in `ready`:
   - Start the `ourkit-implementer` subagent with the task's text, the relevant spec requirements, and any rules that apply. It has no other context. If `ourkit mockup show` says the change has an approved mockup, give it the mockup's path for any task that builds what people see: the user agreed to that picture, so build to it.
   - Read the result and its diff yourself. Check it does the task and nothing more.
   - Run the task's `Verify:` check, using the `ourkit-runner` subagent for commands. If the check is the project's tests, lint or build, it runs `ourkit gate run <name>`, because a Hands-off session's permissions don't allow the command itself.
   - If it worked, commit it on the branch, then run `ourkit task done <id>`.
4. Run `ourkit task list` again and repeat until `finished` is true or nothing is `ready`.
5. If a task can't be finished, run `ourkit task block <id> "<reason>"`. Independent tasks still become ready, so carry on with those. In Pair, ask the user about the block; in Hands-off, add it to the Question Batch. Update the ticket as `.ourkit/kit/core/tracker.md` describes.

## Patch

There's no plan or task list. Delegate the change to the `ourkit-implementer` subagent, read its diff yourself, then run `ourkit gate floor`. If it blocks, this is no longer a Patch: raise the Tier and start from the Feature path.

## Testing

After the work, run `ourkit gate run test`, `ourkit gate run lint` and `ourkit gate run build`, and act on each `action` as `.ourkit/kit/core/gate.md` describes.

- A `not-run` result means nothing was verified. Report it as not run, and never guess a replacement command.
- Judge only files in `ourkit gate scope`. Failures that come only from older code are for reporting, not fixing here.
- New behaviour needs tests when the project can run them, written first as `.ourkit/kit/core/testing.md` describes. If it can't be tested here, add it to the Test Handoff with step-by-step instructions.
- Check each diff against `.ourkit/kit/core/security.md` as well as the task. A test that was skipped, disabled or loosened to pass is a failure, not a pass.

## Handing over

Continue to Review, unless a Gate is still blocking or tasks remain blocked. Then stop and report which ones, and why.

End with the Next line (`.ourkit/kit/core/next-step.md`): `/ourkit-review`. If something is blocked, the next step is what unblocks it, then `/ourkit-build` again.

Report only results you actually observed. Don't push, merge or deploy in this Stage.
