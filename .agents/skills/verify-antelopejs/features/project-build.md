---
covers:
  - src/cli/commands/project/build*.ts
  - src/core/build/**
  - src/core/runtime/build-*.ts
  - src/core/modules/build-artifact.ts
  - src/core/config/**
docs:
  - docs/5.cli/2.project.md
  - docs/2.concepts/4.configuration.md
---

# Project build

`ajs project build` resolves the project's modules once and writes `.antelope/build/build.json`, which `ajs project start` and `launchFromBuild` read.

## Sub-features

- `build-artifact`: the artifact exists and lists every module.
- `build-env`: without `environments` any `--env` builds the base; once `staging` is declared, `--env nope` exits 2 and writes no artifact, `--env staging` builds.
- `build-range-conflict`: error path: a consumer requiring `verify-greeter ^2.0.0` against the shared 1.0.0 fails the build with the conflict, the module the shared copy comes from and the fix, writes no `build.json`, and `start` then finds no build.
- `build-no-project`: empty path: outside a project, exit 1.

## How to get to it (user POV)

- `ajs project build -e production`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" project-build [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/project-build/<journey>/`.

## Gotchas

- `build.json` is a Format surface: its shape must stay readable by the next `start`. `project-start` checks a base-branch build against the head.
