# Overrides

Kit files in a project are read-only (ADR 0007). To customize one, put a copy at the same path under `.ourkit/overrides/`:

| Kit file | Override |
|---|---|
| `.ourkit/kit/core/rule-layering.md` | `.ourkit/overrides/core/rule-layering.md` |
| `.ourkit/kit/roles/backend/checklist.md` | `.ourkit/overrides/roles/backend/checklist.md` |

| `.claude/skills/ourkit-plan/SKILL.md` | `.ourkit/overrides/stages/ourkit-plan/SKILL.md` |
| `.claude/agents/ourkit-runner.md` | `.ourkit/overrides/agents/ourkit-runner.md` |

The Override replaces the whole file and keeps the original's place in rule layering. `ourkit rules` labels it `(Override)`. A Stage or subagent Override takes effect the next time the Installer or `upgrade` runs, because the Host reads those from its own folders.

## Upgrading

Run `upgrade` from the newest kit package, using the command in the kit's README, because the copy inside the project is the old version. It replaces only kit files and never touches Overrides, Project Rules, Project Roles or Stack Packs.

If a kit file was edited by hand, `upgrade` lists it and offers to move the edit into an Override. If you decline, nothing changes. `--move-edits` accepts the move without asking, and `--discard-edits` throws the edits away. The kit's own `bin` and `src` can't be overridden, so edits there stop the upgrade until you rerun with `--discard-edits`.

`ourkit check --project [project-dir]` reports an Override with no matching kit file, because it has no effect.

Use an Override to change how the kit behaves. To add a project's own rules, use Project Rules instead.
