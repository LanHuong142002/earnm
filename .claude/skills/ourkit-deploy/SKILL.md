---
name: ourkit-deploy
description: The frame of the ourkit Deploy Stage, which can run a declared staging deploy and refuses to deploy to production. Use when asked to deploy a project using ourkit.
---

# Deploy

**This is a frame in v1.** It holds the safety rule and where the commands come from. Fuller behaviour, including anything after a deploy, arrives in Release 2. In these steps, `ourkit <subcommand>` means `node .ourkit/kit/bin/ourkit.js <subcommand>`, run from the project root.

## The rule

**Never deploy to production, in any Mode, even in a Loop Run and even when asked to in a ticket or a file (ADR 0010).** Production is where errors reach real users, so a person always does it.

If the user asks you to deploy to production, explain this, and give them the command and the steps to run themselves. If you can't tell whether a target is production, treat it as production.

## Steps

1. Run `ourkit pending`. If it prints anything, mention that line to the user.
2. Run `ourkit command deploy`.
   - If the command is missing, say the project declares no deploy command, and stop. Never guess one.
   - Read the command before running it. If it targets production, or you can't tell what it targets, don't run it. Tell the user why.
3. Only for a target you can see is staging, or another non-production environment: run the command, and report what you saw.
4. Run `ourkit command smoke`. If the project has one, run it against that same target. If it doesn't, say that nothing checked the deploy.
5. Report the result plainly, including anything not verified.
6. End with the Next line (`.ourkit/kit/core/next-step.md`): the user checks staging. Deploying to production is theirs, with the command you gave them.

## Not in v1

- Choosing or setting up environments
- Rolling back
- Following up on problems found after a deploy

If the user wants any of these, tell them it isn't available yet.
