---
covers:
  - src/cli/commands/project/dev*.ts
  - src/cli/commands/project/run.ts
  - src/cli/commands/project/index.ts
  - src/cli/commands/shared/project-command.ts
  - src/cli/lock.ts
  - src/cli/process-runner.ts
  - src/core/repl/**
  - src/core/runtime/**
  - src/core/modules/**
  - src/core/config/**
  - src/core/filesystem/**
  - src/core/output/child-process.ts
  - src/core/output/tasks.ts
  - src/utils/**
  - src/types/**
docs:
  - docs/5.cli/2.project.md
  - docs/2.concepts/7.runtime.md
  - docs/2.concepts/2.modules.md
---

# Project dev

`ajs project dev` (alias `ajs project run`) installs and loads the project's modules and keeps them running. `--watch` reloads a module when its watched files change; a failed reload keeps the previous instance.

## Sub-features

- `dev-call-stop`: the module serves; SIGINT exits 130 with `Stopped the project`; the port is refused afterwards.
- `dev-hmr`: with `--watch`, two edits of `src/message.ts` each reach the HTTP answer.
- `dev-failed-reload`: error path: a syntax error logs `Failed to reload module`, the old answer keeps serving, the next good edit recovers.
- `dev-run-alias`: `ajs project run` behaves as `dev`.
- `dev-project-flag`: `--project ./app` from the parent folder.
- `dev-cancel-during-start`: cancel path: SIGINT before the module answers exits 130 and nothing binds the port afterwards.
- `dev-inspect`: `--inspect 127.0.0.1:<port>` prints the address and the inspector answers `/json/version`.
- `dev-no-project`: empty path: outside a project, exit 1 with `No AntelopeJS project found`.

## How to get to it (user POV)

- `ajs project dev --watch` in a project folder
- `ajs project dev -p ./my-app -e staging`
- `ajs project dev --inspect 0.0.0.0:9229`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" project-dev [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/project-dev/<journey>/`.

## Gotchas

- The watcher arms after the modules start and prints nothing when armed; HMR journeys wait 3 s after the first answer (`settle`) or the first edit is absorbed into the baseline hash.
- `--interactive` (REPL) is not driven: it needs a terminal. Report it under Not verified when the diff touches `src/core/repl/repl-session.ts`.
- Module add or remove while dev runs goes through the configuration watcher, which restarts the project; the formal model `formal-module-lifecycle` covers its orderings.
