# Gate

A Gate is a control point between two Stages. A change needs a Tier before any Gate can run, because the Tier decides how strict the Gate is.

## What a Gate decides

| Result | Tier | Severity |
|---|---|---|
| Passed | Any | None |
| Failed | Patch outside any Sensitive Area | Remind |
| Failed | Feature, Epic, or anything touching a Sensitive Area | Block |
| The project has no such command | Any | Remind |

The Mode decides what happens next:

| Severity | Pair | Hands-off |
|---|---|---|
| Block | `ask-user`: show the problem and ask how to proceed | `fix-or-stop`: fix it, or stop and add it to the Question Batch |
| Remind | `mention`: tell the user and continue | `log-decision`: add it to the Decision Log and continue |

## Commands

- `ourkit gate run <test|lint|build>` runs the command from the Stack Profile and prints JSON with `status`, `severity`, `action` and, on failure, the end of the output. Exit code 1 means the Gate blocks.
- `ourkit gate floor` checks whether a Patch has grown into a Sensitive Area. Run it at each Gate of a Patch, because a change's files can differ from when its Tier was set. If it fails, raise the Tier.
- `ourkit gate scope` prints the files the Gate may judge.
- `ourkit gate path <document>` prints where a Stage's document lives, such as `spec`.
- `ourkit gate artifact <document>` checks that the document exists with every section filled in. It blocks at any Tier, because the next Stage can't start from an incomplete document. It checks only that sections are present, so the Stage must still judge their quality.

A `status` of `not-run` means nothing was verified. Report it as not run, never as passed, and never guess a replacement command. Deploying is never a Gate command (ADR 0010).

- `ourkit gate review` checks that the change was reviewed as it now stands, with no blocking finding left.
- `ourkit gate ship` checks that a PR may open: reviewed, every task finished, everything committed, not on the default branch, and with a Change Report when one is required.
- `ourkit gate approval` checks that Build may start. In Pair, the user must have approved this exact plan. Hands-off passes.
- `ourkit gate approve-plan` records the approval. Run it only after the user has said they approve. Never run it on their behalf or because they went quiet. Changing the plan afterwards makes it need approving again.
- In Hands-off, a change touching a Sensitive Area or needing the user to act on a service stops at `gate approval` and again at `gate ship`, with the action `stop-for-user`. `ourkit gate approve-ship` records the second approval, under the same rule. Changing the work afterwards makes it need approving again.

## Judge only the change

Apply standards only to the files in `gate scope`, not to older code (ADR 0006). When a project has a Baseline, a branch started before it is compared from the Baseline.

A command may report problems in older code, because it can run across the whole project. Report only the problems in scoped files as failures of this change. If a failure comes only from older code, tell the user it exists, and don't block on it or fix it as part of this change.
