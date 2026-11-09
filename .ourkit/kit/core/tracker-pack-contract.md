# Tracker Pack contract

A Tracker Pack is an optional folder connecting Core to one Tracker, with a lowercase hyphenated name:

- `pack.json`: `name`, matching the folder, and `tracker`, the name of the Tracker it connects to.
- `operations.md`: how to do each operation, under these `##` headings:
  - `## Read a ticket`
  - `## Change status`
  - `## Comment`
  - `## Attach a PR link`

Each operation uses MCP when a Connector is available, and otherwise a CLI. Core uses only these four operations, so it never depends on a particular Tracker. The lifecycle still works with no Tracker Pack.

Install one by running the kit's `tracker add <name>` command from its package, using the command in the kit's README. It's copied to `.ourkit/kit/tracker-packs/<name>/`, and `upgrade` keeps it up to date.
