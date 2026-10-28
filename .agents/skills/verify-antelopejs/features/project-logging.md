---
covers:
  - src/cli/commands/project/logging/**
  - src/logging/**
  - src/core/output/logging-utils.ts
docs:
  - docs/5.cli/2.project.md
  - docs/2.concepts/5.logging.md
---

# Project logging

`ajs project logging show|set` reads and changes the `logging` block of `antelope.config.ts`.

## Sub-features

- `logging-show-defaults`: the default settings as lines and as JSON.
- `logging-set-roundtrip`: `set` with every kind of flag, read back with `show --json`, then `--remove-include` read back again.
- `logging-set-usage-error`: error path: `--level` without `--format` exits 2 and writes nothing.
- `logging-set-needs-input`: empty path: `set` with no flag under `CI=1` exits 2 and writes nothing.

## How to get to it (user POV)

- `ajs project logging show --json`
- `ajs project logging set --enable-module-tracking --include-module @antelopejs/api`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" project-logging [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/project-logging/<journey>/`.

## Gotchas

- `show --json` merges the defaults, so a key the user never set still appears.
