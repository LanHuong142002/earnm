# Role contract

A Role is one atomic specialty, in its own folder with a lowercase hyphenated name:

- `guidance.md`: how to work in this specialty. It must not be empty.
- `checklist.md`: what a Reviewer verifies. It must have at least one `- [ ]` item, and each item should be something a reader of the diff can answer.

A project can enable several Roles at once. Full-stack is the name for enabling the frontend and backend Roles together, so `fullstack` and `full-stack` are not valid Role names.

Kit Roles live in `roles/` and can't name a technology, because deep conventions belong in a Stack Pack (ADR 0002).

A Project Role lives in `.ourkit/roles/<role>/` beside Project Rules and follows the same contract. It belongs to one project, so it may name that project's technology. Verify Project Roles with `ourkit check --project [project-dir]`.
