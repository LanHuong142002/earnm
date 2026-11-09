# Backend checklist

- [ ] All new input is validated at the boundary.
- [ ] Every changed operation checks permissions on the server.
- [ ] Data and schema changes handle existing data and have a safe rollout.
- [ ] Public interface changes are backward compatible, or the break is deliberate and stated.
- [ ] Multi-step writes stay consistent when they partly fail or are retried.
- [ ] Queries and loops stay bounded as data grows.
- [ ] Errors are handled, and responses don't reveal internals.
- [ ] Logs contain no secrets or personal data.
- [ ] Tests cover failure paths, not only the success path.
