---
covers:
  - src/cli/commands/config/**
  - src/cli/common.ts
  - src/cli/git-url.ts
docs:
  - docs/5.cli/4.config.md
---

# Config

`ajs config show|get|set|reset` reads and writes `~/.antelopejs/config.json`, shared by every project.

## Sub-features

- `config-defaults`: a fresh HOME shows the default repository, not marked custom.
- `config-set-get`: `set` writes the file; `get`, `get --json` and `show` read it back.
- `config-set-invalid`: error path: an invalid URL exits 2 and the value stays the default.
- `config-unknown-key`: error path: `get nope` and `set nope` exit 1 and list the valid keys.
- `config-reset`: cancel path: `reset` without `--yes` under `CI=1` exits 2 and keeps the value; `--yes` restores the default.
- `config-base-file`: Format containment: a file written by the base branch's CLI reads back with the head's CLI.

## How to get to it (user POV)

- `ajs config set git https://github.com/acme/interfaces.git`
- `ajs config get git`
- `ajs config reset --yes`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" config [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/config/<journey>/`.

## Gotchas

- Each journey has its own HOME, so a setting never leaks between journeys.
