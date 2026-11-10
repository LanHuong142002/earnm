---
name: ourkit-qa
description: Checks a reviewed Feature against each Acceptance Criterion in its spec by running it, and records a pass, fail or by-hand result for each. Use after the ourkit Review Stage, or when asked to run ourkit QA.
---

# QA

Passing tests prove the code does what its tests say. QA proves the change does what the spec says, by using it the way a person would. In these steps, `ourkit <subcommand>` means `node .ourkit/kit/bin/ourkit.js <subcommand>`, run from the project root.

## Before you start

1. Run `ourkit pending`. If it prints anything, mention that line to the user.
2. Run `ourkit tier show` and `ourkit mode`.
3. Run `ourkit gate review`. If it blocks, go back to Review first, because QA checks the change as reviewed.
4. **Only a Feature has QA.** A Patch has no spec, and a Bug-fix checks its fix in Verify. If `ourkit qa criteria` says it isn't required, tell the user and continue to the next Stage.

## Steps

1. **Start the `ourkit-qa` subagent.** Tell it only to check the Active Change against its Acceptance Criteria. Don't explain the work or what you're worried about, because a tester who knows how it was built tests what was built, not what was asked.
2. **Record each result** with `ourkit qa check <n> <pass|fail|manual> "<how it was checked and what was seen>"`. Keep the subagent's words, and don't turn a fail into a pass because it's inconvenient. If you think a result is wrong, check it yourself first.
3. **Handle each fail as a blocking Review finding.** Record it with `ourkit review add blocking "QA criterion <n>: <what was expected and what was seen>"`, then fix it the way `/ourkit-review` does: delegate the fix to the `ourkit-implementer` subagent, verify it, run `ourkit review resolve <id>`, and review again what changed. Then run the QA subagent again for that criterion and any other the fix could affect, and record the new results.
   - In Pair, ask the user if the fix is a judgment call, or if the criterion itself looks wrong. Changing the spec is the user's decision.
   - In Hands-off, run `ourkit review attempt <id>` before each fix. You get at most two attempts. When it refuses, stop fixing it, add it to the Question Batch, and carry on with anything independent (ADR 0009).
4. **Handle each manual one.**
   - In Pair, give the user its steps and expected result, and ask them to check it now. Record what they report, as "checked by the user: …".
   - In Hands-off, add it with `ourkit handsoff test-handoff "<criterion>" "<steps>. Expected: <result>"` and record it as manual.
5. **Finish** with `ourkit qa complete`, then `ourkit gate qa`. The Gate blocks if a criterion is unchecked or failed, or if the change has moved since QA.

## Handing over

Show the user the table from `ourkit qa table`. Ship puts it in the Change Report and the PR. Don't push, merge or deploy in this Stage.

End with the Next line (`.ourkit/kit/core/next-step.md`): `/ourkit-ship`, to open the PR. If a criterion is still failing, the next step is fixing it, or the user deciding whether the spec should change.
