---
covers:
  - src/cli/commands/module/index.ts
  - src/cli/commands/module/init*.ts
  - src/cli/git-operations.ts
  - src/cli/git-url.ts
  - src/core/output/prompt.ts
  - src/core/output/package-manager*.ts
docs:
  - docs/5.cli/3.module.md
  - docs/3.module-development/1.creating-a-module.md
---

# Module init

`ajs module init` creates a module from a template of the interface repository given by `--git`, `ANTELOPEJS_GIT` or the git setting.

## Sub-features

- `module-init-flags`: every answer as a flag; package, sources and installed dependencies exist; no `.git`.
- `module-init-env-git`: `ANTELOPEJS_GIT` selects the repository like `--git`.
- `module-init-needs-input`: empty path: no `--template` under `CI=1` exits 2 and writes nothing.
- `module-init-occupied`: error path: a non-empty target fails and stays identical.
- `module-init-unknown-template`: error path: exit 2 with the available templates.
- `module-init-bad-git`: error path: an unreachable repository exits 1 with `Could not fetch templates`.

## How to get to it (user POV)

- `ajs module init ./modules/my-module --template "Blank Typescript" --pm pnpm --no-git-init`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" module-init [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/module-init/<journey>/`.

## Gotchas

- `--interfaces` needs interface folders in the manifest repository; the offline manifest has one, `greeter`.
