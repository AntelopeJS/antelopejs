---
covers:
  - src/core/modules/module-locks.ts
  - src/core/downloaders/package-locks.ts
  - src/cli/commands/project/modules/module-locks.ts
  - src/core/runtime/module-loading.ts
docs:
  - docs/5.cli/2.project.md
  - docs/2.concepts/4.configuration.md
---

# Project module locks

The dependencies of an npm module are installed inside `.antelope/cache/<module>`. `ajs project build` (and `dev`, `modules add|install`) records the lockfile the module's package manager wrote there in `antelope-lock/<package>@<version>/`, replays it on the next install, and `ajs project modules update` resolves it again. `--frozen-modules` installs only from recorded locks.

## Sub-features

- `locks-record-replay`: a build records `pnpm-lock.yaml` and `package-lock.json`; after a dependency release, a cold rebuild still installs the recorded version, while a control copy without locks (and the base CLI) moves to the new one.
- `locks-warm-cache`: a cached module installed from another lockfile than the record is reinstalled from the record.
- `locks-update-moves`: `modules update` rewrites the lock with the new dependency version (diff in the evidence); a module upgrade adds the new version's lock and removes the old one.
- `locks-frozen`: error path: `build --frozen-modules` without locks exits 1, writes no lock and no build; with locks it installs the recorded versions; `ANTELOPEJS_FROZEN_MODULES=1` does the same.
- `locks-environments`: two environments pinning two versions get one lock each.

## How to get to it (user POV)

- `ajs project build`, then commit `antelope-lock/`
- `ajs project modules update`
- `ajs project build --frozen-modules` in CI

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" project-module-locks [journey-id...]
```

## Gotchas

- npm modules need a registry: each journey starts `bin/lib/registry.mts`, an npm registry on 127.0.0.1 served from the harness process, and points npm and pnpm at it with `npm_config_registry`, with their caches and the pnpm store in the journey's folder. `registry-requests.txt` in the journey's evidence lists what they fetched.
- `verify-lock-pnpm` names `pnpm@10.6.5` as its package manager, so its install runs through corepack, which must already have that version.
