# Loop Run

A Loop Run is Hands-off in cycles over many tickets. The user starts it in a terminal, from the default branch with a clean tree:

```
node .ourkit/kit/bin/ourkit.js loop run --hours 4 42 43 44
```

**It needs a Budget.** Without `--hours` or `--tokens`, it won't start (ADR 0009). With both, whichever runs out first ends the run. The hours count time spent in sessions, and the tokens are the input, output and cache-write tokens the sessions report.

## How it works

The kit's command coordinates, not an agent. For each ticket it starts a fresh session on the `ourkit-handsoff` Stage, then keeps only a five-line summary. That keeps the tenth ticket costing about the same as the first (ADR 0011). Only Lessons and the Project Log carry to the next ticket.

Each ticket's work stays on its own branch. A session that stops midway has its work saved on that branch, so nothing is lost. A ticket that stays queued, because its session failed or the run was killed, carries on from that branch the next time, rather than starting again. After a killed run, `ourkit loop run` saves what was left uncommitted and goes back to the default branch by itself.

## When it stops

| `stopped` | Meaning |
|---|---|
| `done` | The queue is empty and at least one ticket shipped |
| `all-blocked` | The queue is empty and nothing shipped |
| `budget` | The Budget ran out |
| `waiting-for-limit` | The plan's usage limit is close, so no new ticket started. The ticket stays queued |
| `session-failed` | A session failed for another reason. The ticket stays queued |
| `dirty-tree` | A session left uncommitted work on the default branch |

Every stop writes a Run Report to `.ourkit/run-report.md`: what's waiting for the user, the Question Batch, the Test Handoff, the Decision Log and what finished. Use `/ourkit-run-report` to go through it. Run `ourkit loop status` to see the raw results, and `ourkit loop run` with no tickets to continue a queue. A ticket that stops at a Hands-off stop doesn't end the run; the next ticket starts.

## The plan's usage limit

When the Host reports plan usage, a run stops taking new tickets at 90% of any window and warns the user. A ticket already running isn't interrupted. Add `--wait` and the run carries on by itself once the limit refreshes, as long as that's within 6 hours and the terminal stays open. Otherwise, it stops, and `ourkit loop run` continues it later.

A Host that doesn't report usage can't pause early, and works the same otherwise. A session that fails at the limit keeps its ticket queued either way.

## The limits

Sessions run with the permissions in `.ourkit/kit/host/session-settings.json`, which deny merging, force-pushing, pushing to the default branch and closing issues, as a Host-level guard behind the Gates. To let sessions run your project's own commands, put an edited copy at `.ourkit/overrides/host/session-settings.json`. It takes effect the next time `upgrade` runs.

A blocking finding gets at most two automatic fixes, tracked with `ourkit review attempt <id>`. After that, the session moves to another independent task or stops (ADR 0009).
