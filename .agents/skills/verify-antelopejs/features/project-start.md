---
covers:
  - src/cli/commands/project/start*.ts
  - src/cli/production-start.ts
  - src/core/runtime/build-runtime.ts
  - src/core/runtime/build-refresh.ts
  - src/core/repl/launch.ts
docs:
  - docs/5.cli/2.project.md
---

# Project start

`ajs project start` runs a project from its build artifact, without downloading modules. `--refresh-config` resolves the configuration again and exits 3 when the module set differs from the build.

## Sub-features

- `start-from-build`: the built project serves and SIGINT stops it.
- `start-without-build`: error path: exit 1, `No build found`, and the hint to run `ajs project build`.
- `start-refresh-config`: `--refresh-config` with an unchanged module set serves.
- `start-refresh-config-changed`: error path: a module added after the build makes `--refresh-config` exit 3.
- `start-base-build`: Format containment: a `build.json` written by the base branch's CLI starts with the head's CLI.

## How to get to it (user POV)

- `ajs project build && ajs project start`
- `ajs project start -e production --refresh-config`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" project-start [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/project-start/<journey>/`.

## Gotchas

- Finding on main 9b81264: `start-without-build` fails. The error carries `Run 'ajs project build --env <env>' first.` on its second line, but the CLI prints only the first line unless `--verbose` is set. The journey stays as written; it passes once the hint reaches default stderr.
- `start-base-build` needs the base CLI that `verify-ajs new` builds from `--base` (default `origin/main`).
