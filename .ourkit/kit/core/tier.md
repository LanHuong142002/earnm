# Tier

Every change has a Tier, which decides the Stages it goes through:

| Tier | When | Stages |
|---|---|---|
| Patch | A small change, outside any Sensitive Area | Build, Review |
| Feature | Anything else that fits one cycle | Spec, Plan, Tasks, Build, Review, Ship |
| Epic | Too large for one cycle | Grill, Split into Features |

## Choosing a Tier

1. Run `ourkit tier scan` to see which changed files look like a Sensitive Area. It reads file paths only, so it can miss one.
2. Judge the change itself. Sensitive Areas are auth and permissions, data, schema, money, and public API. A change can touch one without any file path saying so.
3. Propose a Tier with a one-sentence reason. In Pair, wait for the user to confirm. In Hands-off, settle it and add it to the Decision Log.
4. Record it with `ourkit tier set <tier> --reason "<why>"`, adding `--sensitive <areas>` for each Sensitive Area you found.

## The floor

A change touching a Sensitive Area is at least a Feature, even for one line, and the user can't lower it (ADR 0004). `tier set` refuses a Patch in that case.

If the scan matched a file that isn't really sensitive, such as a `tokens.css` of design values, record why with `--not-sensitive "<reason>"`. Use this only for a false match, never because a change feels small. If you're unsure, it's sensitive.

Read the current Tier and Stages with `ourkit tier show`.
