# Stack Profile

A project declares its technology and commands in `.ourkit/stack-profile.json`. Core never assumes either one.

```json
{
  "technologies": ["<technology name>"],
  "commands": {
    "test": "<the project's test command>",
    "lint": null
  }
}
```

- `technologies` lists names and is required. It may be empty for a blank project.
- `commands` is required and may hold `test`, `lint`, `build`, `run`, `deploy` and `smoke`. Every one is optional.
- A command set to `null` means the project has none. An absent command means it isn't declared yet.

## Looking up a command

Run `ourkit command <name> [project-dir]`, or read the file directly when the command isn't available.

| Exit code | Meaning | Output |
|---|---|---|
| 0 | Found | The command, on stdout |
| 1 | Missing: no Stack Profile, not declared, or `null` | The reason, on stderr |
| 2 | The Stack Profile or the requested name is invalid | The problem, on stderr |

## When a command is missing

1. Never guess a command, and never fall back to a common default.
2. Report that the work didn't run and give the reason. Don't report it as passed.
3. Don't treat a missing command as a failure of the change. The Gate decides what happens next.

An invalid Stack Profile is different: stop and show the problem, because any answer read from it can't be trusted.
