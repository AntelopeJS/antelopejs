---
covers:
  - src/cli/commands/project/modules/**
  - src/cli/common.ts
  - src/core/downloaders/**
  - src/core/config/config-editor.ts
  - src/core/config/config-writes.ts
  - src/core/config/module-declarations.ts
  - src/core/config/module-entry.ts
  - src/core/modules/module-manifest.ts
  - src/core/output/package-manager*.ts
docs:
  - docs/5.cli/2.project.md
  - docs/2.concepts/4.configuration.md
---

# Project modules

`ajs project modules add|list|remove|install|update` edits the modules of `antelope.config.ts` and downloads them. Every mutation is read back with `ajs project modules list --json`.

## Sub-features

- `modules-list-empty`: empty path: a project without modules lists `[]` and prints no line.
- `modules-add-remove-local`: `add --mode local` then `remove`, each read back with `list --json` and the text listing.
- `modules-add-keeps-config`: Data containment: `add` on a hand-written configuration keeps the name, the module config and `environments`.
- `modules-remove-unknown`: error path: an unknown name removes nothing; `--force` removes the known ones.
- `modules-add-unreachable-package`: error path: an npm package the offline store cannot serve exits 1 and leaves the tree identical.
- `modules-install`: `install --git <manifest> --yes` adds the provider of an unimplemented interface; `dev` then serves the consumer's greeting.
- `modules-install-range-conflict`: error path: `install --yes` adds `greeter-provider`, then exits 1 because the consumer's `^2.0.0` excludes the shared `verify-greeter` 1.0.0; the added provider stays in the configuration.
- `modules-update-dry-run`: empty path: no npm module, `Nothing to update`, configuration unchanged.

## How to get to it (user POV)

- `ajs project modules add @antelopejs/api`
- `ajs project modules add ./modules/auth --mode local`
- `ajs project modules install --yes`
- `ajs project modules update --dry-run`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" project-modules [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/project-modules/<journey>/`.

## Gotchas

- Every install runs with `npm_config_offline=true`; a package not in the warm store is an error path, not a product failure.
- `add --mode local` builds the module with `npx tsc`, so local fixtures carry `typescript` in their lockfile.
- `--mode git` and `--mode dir` and a real npm `update` need the network; report them under Not verified when their downloader changes.
