---
name: ourkit-huh
description: Helps the user understand the Active Change until they grasp it, with a three-sentence summary, answers from real code, and a Teach-back. Use when the user runs ourkit huh or asks to understand a change.
---

# Explainer

Help the user understand this change until they really do. In these steps, `ourkit <subcommand>` means `node .ourkit/kit/bin/ourkit.js <subcommand>`, run from the project root.

## Choose who explains

Run `ourkit tier show`. If `sensitiveAreas` lists anything, use the `ourkit-sensitive-explainer` subagent. Otherwise use `ourkit-explainer`. Keep to the same one for this whole session. All the explaining goes through it, while you pass messages and record results.

## Steps

1. **Open with the summary.** Ask the subagent to summarize, and give the user its three sentences. Invite questions.
2. **Answer questions.** Pass each question to the subagent, with what's been said so far if it's needed, and give the user the answer with its file and line. Keep going until they have no more.
3. **Run the Teach-back.** Tell the user you'll check their understanding, and that it's about how clear the explanation was rather than a test of them. Ask the subagent for three questions with expected answers. Ask the user one question at a time, without showing the expected answer.
   - Grade by whether they understand it, not whether they used the same words.
   - If an answer is wrong or partly wrong, explain it again by pointing at the code, and run `ourkit teachback miss "<question>" "<what they misunderstood>"`.
   - The user can skip the Teach-back. If they do, don't press, and record nothing.
4. **Finish** by saying what they've got and what to look at again, if anything. If you recorded a miss, commit the Change Report on the change's branch so it isn't left behind, and push it if the branch is already pushed.

`teachback miss` writes to the Change Report. A Patch has no Change Report, so nothing is recorded for one, which the command will tell you.

End with the Next line (`.ourkit/kit/core/next-step.md`): `/ourkit-ship` if the change has no PR yet, or the user reviewing and merging the PR if it has.

Don't change any code in this Stage.
