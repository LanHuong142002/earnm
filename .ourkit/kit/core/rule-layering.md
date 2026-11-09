# Rule layering

Rules apply in this order, and a later layer wins when rules conflict:

1. Core: `.ourkit/kit/core/`
2. Role: `.ourkit/kit/roles/<role>/`, then Project Roles in `.ourkit/roles/<role>/`
3. Stack Pack: `.ourkit/kit/stack-packs/<pack>/`
4. Project Rules: `.ourkit/rules.md`

A Role or Stack Pack is enabled by being installed in the project. Within a layer, files apply in sorted path order.

Project Rules are the project's own file, written in plain Markdown. The kit never overwrites them, and the file is optional.

Run `ourkit rules [project-dir]` to print every rule in this order. Each section starts with a comment naming its layer and file.

Rules guide the work; they can't remove the kit's hard limits. Project Rules can't lower the Sensitive Area floor (ADR 0004), start a Loop Run without a Budget (ADR 0009), let the agent deploy to production by itself (ADR 0010), or make a ticket's content a command (ADR 0012).
