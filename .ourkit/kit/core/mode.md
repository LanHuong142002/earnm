# Mode

Every change runs in one Mode, read with `ourkit mode` and set with `ourkit mode <pair|hands-off>`. The default is Pair, because mistakenly using Hands-off costs more than mistakenly using Pair (ADR 0012). Set Hands-off only when the user asks for it.

| | Pair | Hands-off |
|---|---|---|
| The user | Sits with the agent | Reviews the result later |
| Gates | Ask immediately | Settle what they can and report later |
| Plan | The user approves it | Doesn't wait, except for the stops below |
| A minor decision | Ask, or decide and mention it | Decide, and add it to the Decision Log |
| A question that needs the user | Ask now | Add it to the Question Batch and carry on with what doesn't depend on it |
| The Explainer | Suggested | Not suggested |

Hands-off stops twice, after Plan and before Ship, when a change touches a Sensitive Area or needs the user to act on a service. In both Modes, merging and deploying to production are the user's job (ADR 0010).

## Decision Log

Record a minor decision settled without the user, with a one-sentence reason:

`ourkit decision add "<decision>" --why "<reason>"`

Log what the user might want to review later, such as a choice between approaches. Don't log routine steps. A decision that would be costly to get wrong isn't minor, so it belongs in the Question Batch instead. Read the log with `ourkit decision list`.

## Question Batch

Gather questions so the user answers them at once instead of being interrupted for each:

`ourkit question add "<question>"`

Write each question so it can be answered without other context, and include your recommendation. Read them with `ourkit question list --open`, and record a reply with `ourkit question answer <id> "<answer>"`.
