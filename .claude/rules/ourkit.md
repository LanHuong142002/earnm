# ourkit

This project follows ourkit's lifecycle. Here, `ourkit` means `node .ourkit/kit/bin/ourkit.js`, run from the project root. If `.ourkit/stack-profile.json` doesn't exist, ask the user to run `/ourkit-init` first.

When you're asked to change this project, before you edit anything:

1. Work on a branch, never on the default branch.
2. Follow `.ourkit/kit/core/tier.md` to propose a Tier, and wait for the user to confirm it. A change touching auth, data, schema, money or a public API is at least a Feature, however small.
3. Follow the Stages that `ourkit tier show` lists, using their `ourkit-*` skills, and don't go around a Gate.

Questions and reading need none of this, and neither does a user's explicit request to skip it for a change outside the project's code.
