---
name: ourkit-review
description: Reviews the Active Change, in a fresh context from Feature up, with findings marked blocking or non-blocking. Use after the ourkit Build Stage, or when asked to run an ourkit review.
---

# Review

Judge the change against its spec, by a reader not biased by how the work was done. In these steps, `ourkit <subcommand>` means `node .ourkit/kit/bin/ourkit.js <subcommand>`, run from the project root.

## Before you start

1. Run `ourkit pending`. If it prints anything, mention that line to the user.
2. Run `ourkit tier show` and `ourkit mode`.
3. Run `ourkit gate floor`. If it blocks, this change can't stay a Patch, so raise its Tier first.

## Who reviews

- **Feature or Epic:** start the `ourkit-reviewer` subagent. Tell it only to review the Active Change. Don't explain the work, share your reasoning or mention what you're worried about, because a fresh view is the point.
- **Touching a Sensitive Area:** also start the `ourkit-sensitive-reviewer` subagent, the same way.
- **Patch:** review it yourself. Read `ourkit review packet`, then judge the diff against its checklists as strictly as if someone else had written it.

## Handling findings

1. Record each finding with `ourkit review add <blocking|non-blocking> "<finding>"`. Keep the Reviewer's file, line and failure scenario in the text. Don't downgrade or drop a finding because it's inconvenient. If you think it's wrong, verify that against the code first.
2. **Fix blocking findings.** Delegate each fix to the `ourkit-implementer` subagent, verify it, then run `ourkit review resolve <id>`. Resolve a finding only when it's fixed, or you've verified it's wrong and can say why.
   - In Pair, ask the user if a fix is a judgment call.
   - In Hands-off, run `ourkit review attempt <id>` before each fix. You get at most two attempts. When it refuses, stop fixing this finding, add it to the Question Batch, and carry on with any independent task (ADR 0009).
3. **Report non-blocking findings.** In Pair, ask whether to act on them. In Hands-off, list them in your report, and don't act on them unless they're trivial.
4. **Review again if you changed code.** Anything fixed needs a fresh look, since a fix can break something else.

## Finishing

When no blocking finding is left, run `ourkit review complete`, then `ourkit gate review`. The Gate blocks if a blocking finding is unresolved or if the change has moved since it was reviewed.

A Patch ends here. In Pair, tell the user the result so they can commit it. In Hands-off, continue to Ship to open its PR.

Everything else continues to Ship. In Pair, also suggest that the user runs `/ourkit-huh` if they'd like to understand the change first. Don't push, merge or deploy in this Stage.
