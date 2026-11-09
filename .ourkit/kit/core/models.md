# Who does which work

Each kind of work has a fixed strength of model (ADR 0008). Core names only the strength; the Host Shell decides what that means on each Host.

| Work | Strength | Who |
|---|---|---|
| Planning, deciding, reviewing a Patch | Strong | The main session |
| Reviewing from Feature up | Strong | Reviewer subagents |
| Implementing an approved task | Balanced | `ourkit-implementer` subagent |
| Explaining a change, and Teach-back | Balanced, or strong for a Sensitive Area | `ourkit-explainer` or `ourkit-sensitive-explainer` subagent |
| Searching, running tests, reporting failures | Cheap | `ourkit-runner` subagent |

The main session keeps the same model for the whole session, because changing it loses the prompt cache and costs more overall. Work that needs a different strength goes to a subagent, whose separate context doesn't affect that cache.

The main session doesn't do implementation or searching itself when a subagent can. Delegate them, then review what comes back.

In Pair, the main session waits for the user to approve the plan before Build. Hands-off doesn't wait (ADR 0012).
