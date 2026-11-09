---
name: ourkit-ship
description: Opens a PR for the reviewed Active Change that meets the Ticket Standard, and never merges it. Use after the ourkit Review Stage, or when asked to ship an ourkit change.
---

# Ship

Deliver the reviewed change as a clear PR, so the user can decide whether to merge it. In these steps, `ourkit <subcommand>` means `node .ourkit/kit/bin/ourkit.js <subcommand>`, run from the project root.

**Merging is always the user's job, in both Modes. Never merge a PR, enable auto-merge, or push to the default branch (ADR 0010, ADR 0012).** Deploying is a separate Stage.

## Before you start

1. Run `ourkit pending`. If it prints anything, mention that line to the user.
2. Run `ourkit tier show` and `ourkit mode`.
3. **A Patch in Pair doesn't reach this Stage.** It ends at Review, and the user commits it. If that's where you are, tell the user and stop.

## Steps

1. **Write the Change Report** at the path from `ourkit gate path report`. A Feature or an Epic has one, and so does a Bug-fix touching a Sensitive Area; a Patch doesn't, so skip this step for one. Use these `##` sections:
   - **Summary:** exactly five lines, so someone can understand the change without reading the diff: what changed, why, how it was verified, what to watch for, and what's left.
   - **Details:** the decisions behind it, what was reviewed and found, and anything not verified.
2. **Commit the work.** Commit anything still uncommitted on the change's branch, including its `.ourkit` records. A Patch in Hands-off may still be on the default branch, so create a branch for it first.
3. **Run the Gate** with `ourkit gate ship`. If it blocks, fix each problem it lists, going back to the Stage that owns it. Never work around it.
4. **Write the PR description** to a temporary file, in the PR shape from `.ourkit/kit/core/ticket-standard.md`:
   - **Summary:** what changed.
   - **Context:** why, from the spec.
   - **Scope Boundary:** what's in, what's out, and anything deliberately left undone.
   - **How To Verify:** steps a reviewer can follow, and only test results you actually observed. Say so plainly if something wasn't run or couldn't be verified.
   - **Links & References:** the ticket this closes, if any, and relevant decisions.
   - In Hands-off, also include the Decision Log (`ourkit decision list`), the open Question Batch (`ourkit question list --open`), non-blocking findings, and the Test Handoff with its step-by-step instructions, since the user wasn't there.
5. **Assess it** with `ourkit ticket <file> --title "<title>" --pr`, then judge the rest of 4C yourself. Fix what's wrong.
6. **Push the branch and open the PR** using the project's git host tools. If you can't, because a tool is missing or you aren't signed in, give the user the title and description to use, and add the step with `ourkit pending add`.
7. **Update the Project Log and Lessons,** only if this change has a Change Report, then commit and push them:
   - Run `ourkit log add "<name>" "<one-sentence summary>" "<PR link>"`.
   - Save what's worth remembering with `ourkit lessons add <cost|quality> "<lesson>"`. **Cost** means something like a Stage that cost unusually much, and **quality** means something like an error Reviewers keep catching or a Teach-back question often missed. Write each in one line that would change how a future plan is made, and save nothing if this change taught nothing. Only about 30 lines are kept, and the oldest drop off, so make them count.

8. **Update the ticket,** as `.ourkit/kit/core/tracker.md` describes for an open PR.

## Handing over

Tell the user the PR's link, what they still need to check, and that merging is up to them.
