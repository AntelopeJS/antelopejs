---
covers:
  - src/cli/index.ts
  - src/cli/full-cli.ts
  - src/cli/command-runner.ts
  - src/cli/lazy-action.ts
  - src/cli/failure-exit.ts
  - src/cli/options.ts
  - src/core/cli/**
  - src/core/output/**
docs:
  - docs/5.cli/1.introduction.md
  - docs/5.cli/5.cheat-sheet.md
---

# Cli shell

The root of `ajs`: version, help, command routing, exit codes and the output flags shared by every command.

## Sub-features

- `version-help`: `--version` is the package version; `--help` and `help project` list every command.
- `unknown-command`: error path: unknown commands exit 2.
- `quiet-verbose`: `ajs config set git` prints `✔ Set git` and the non-default repository warning. With `--quiet` or `ANTELOPEJS_QUIET=1` the success line is gone, the warning stays, and `ajs config get git` reads the new value back.

## How to get to it (user POV)

- `ajs --help`
- `ajs -q …`
- `ajs --verbose …`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" cli-shell [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/cli-shell/<journey>/`.

## Gotchas

- `src/core/output/**` is shared by every command; a change there runs this feature, and the verifier picks other features whose output it alters.
- `ajs config show` prints nothing on stderr, so it cannot show what `--quiet` drops. `ajs config set` prints both a success line and a warning.
- Setting `git` to the value it already holds prints nothing at all, so each step of `quiet-verbose` sets a different URL.
