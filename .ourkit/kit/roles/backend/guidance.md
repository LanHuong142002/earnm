# Backend Role

You build the services, data handling and interfaces that other systems rely on. Follow the patterns already in the project before introducing new ones. `.ourkit/kit/core/security.md` and `.ourkit/kit/core/testing.md` apply to everything here.

- Validate all input at the boundary, and treat every caller as untrusted.
- Check permissions on the server for each operation, not only authentication.
- Treat data and schema changes as hard to reverse. Plan how they roll out and how existing data is handled.
- Make multi-step writes safe when they partly fail or are retried.
- Think about scale: unbounded queries, repeated lookups in loops, and long work inside a request.
- Never log secrets or personal data, and return errors that don't reveal internals.
- Auth, data, schema, money and public APIs are Sensitive Areas, so these changes are at least a Feature (ADR 0004).

## Interfaces

Anyone who can see a behaviour will come to depend on it, documented or not. Treat every public behaviour, including error text and ordering, as a promise.

- Define the interface before the code: its inputs, outputs and errors.
- Keep public interfaces backward compatible unless the change is deliberate and stated. Add optional fields rather than changing or removing existing ones.
- Use one error format and one set of status meanings across the whole interface. Callers can't handle errors they can't predict.
- Page every list, with a limit and a stable order.
- Treat responses from outside services as untrusted input, and validate them before use.
- A call that times out has three possible outcomes: it worked, it failed, or nobody knows. Record what you intend before calling out, so an unknown result can be checked rather than retried blindly.
- An operation that changes state and may be retried, especially one that moves money, needs an idempotency key. Take the key from the caller's intent, never per attempt. Claim it in one atomic step, guarded by a uniqueness rule, and reject the same key sent with a different body.

## Performance

- Measure before optimizing. Find the real bottleneck, fix only that, and measure again the same way. A change that doesn't beat the measurement's normal variation is reverted, not kept.
- Fetch related data in the same query rather than one query per row.
- Justify a new index with the query plan before and after. Every index slows every write.
- Cache only what is expensive to produce and read far more than it changes. Put every input that changes the response in the cache key, including the user, tenant and permissions, or one user's data reaches another. Say how stale it may get. Never cache what must be current, such as balances or permissions.

## Excuses to reject

| Excuse | Answer |
|---|---|
| "Nobody uses that undocumented behaviour." | If it can be seen, someone depends on it. |
| "We don't need paging yet." | You will as soon as a list grows. Add it now. |
| "Duplicate requests are rare." | They come together, exactly when a dependency is slow and retries pile up. |
| "Just add an index" or "just cache it". | Measure first. Both cost something forever. |
