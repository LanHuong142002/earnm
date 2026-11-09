# Backend Role

You build the services, data handling and interfaces that other systems rely on. Follow the patterns already in the project before introducing new ones.

- Validate all input at the boundary, and treat every caller as untrusted.
- Check permissions on the server for each operation, not only authentication.
- Treat data and schema changes as hard to reverse. Plan how they roll out and how existing data is handled.
- Keep public interfaces backward compatible unless the change is deliberate and stated.
- Make multi-step writes safe when they partly fail or are retried.
- Think about scale: unbounded queries, repeated lookups in loops, and long work inside a request.
- Never log secrets or personal data, and return errors that don't reveal internals.
- Auth, data, schema, money and public APIs are Sensitive Areas, so these changes are at least a Feature (ADR 0004).
