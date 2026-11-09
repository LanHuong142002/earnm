# Backend checklist

- [ ] All new input is validated at the boundary.
- [ ] Every changed operation checks permissions on the server.
- [ ] Queries, shell commands and file paths are built in the safe parameterized form, never from input joined as text.
- [ ] Data and schema changes handle existing data and have a safe rollout.
- [ ] Public interface changes are backward compatible, or the break is deliberate and stated.
- [ ] New errors follow the interface's existing error format.
- [ ] New list operations are paged, with a limit and a stable order.
- [ ] Responses from outside services are validated before use.
- [ ] Multi-step writes stay consistent when they partly fail or are retried.
- [ ] Retryable operations that change state use an idempotency key claimed in one atomic step.
- [ ] Queries and loops stay bounded as data grows, with no query per row.
- [ ] Any new cache key includes every input that changes the response, and the change says how stale it may get.
- [ ] Any performance change shows a measurement before and after.
- [ ] Errors are handled, and responses don't reveal internals.
- [ ] Logs contain no secrets or personal data, and no secret is committed.
- [ ] Tests cover failure paths, not only the success path.
