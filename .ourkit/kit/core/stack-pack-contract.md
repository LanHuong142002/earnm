# Stack Pack contract

A Stack Pack is an optional folder of deep conventions for one technology, with a lowercase hyphenated name:

- `pack.json`: `name`, matching the folder, and `technologies`, listing at least one name.
- `conventions.md`: the conventions. It must not be empty.

It may hold more Markdown files, which load in sorted path order. Core runs fully with no Stack Pack, so nothing in Core or a Role may depend on one.

Install one with `ourkit pack add <pack-folder> [project-dir]`. The pack is verified first and copied to `.ourkit/kit/stack-packs/<name>/`, where rule layering loads it after Roles and before Project Rules. An installed pack is never overwritten.
