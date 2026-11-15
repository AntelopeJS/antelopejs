---
covers:
  - src/core/resolution/**
  - src/core/modules/module-manager-packages.ts
  - src/core/modules/interface-registry.ts
  - src/core/modules/resolver*.ts
  - src/node-module-internals.d.ts
  - src/core/modules/version-checker.ts
  - src/core/output/interface-*.ts
  - src/utils/package-resolution.ts
  - src/interface-core-guard.ts
docs:
  - docs/2.concepts/1.interfaces.md
  - docs/2.concepts/9.diagnostics.md
  - docs/3.module-development/4.interface-registry.md
---

# Interface resolution

Every interface package has one shared copy per project. A consumer's range must admit it, and a provider must implement it.

## Sub-features

- `resolution-provider-consumer`: a consumer module's HTTP answer comes from the provider through `verify-greeter`.
- `resolution-range-conflict`: error path: `^2.0.0` against the shared 1.0.0 stops the start with the conflict and both fixes.
- `resolution-range-union`: `^0.9.0 || ^1.0.0` admits the shared copy.
- `resolution-missing-provider`: error path: without the provider, a consumer that installed `verify-greeter` gets no greeting, and dev exits non-zero with "Unresolved interface dependencies" naming `greeter-consumer requires verify-greeter`.
- `resolution-missing-interface-package`: error path: without the provider, a consumer that never installed `verify-greeter` exits non-zero, and the CLI names `greeter-consumer requires verify-greeter, which is not installed`, then installing the dependencies of `greeter-consumer` and `ajs project modules install`, instead of "Cannot find module".

## How to get to it (user POV)

- `ajs project dev` on a project whose modules share an interface package

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" interface-resolution [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/interface-resolution/<journey>/`.

## Gotchas

- The formal check `formal-interface-ranges` covers the range rule for every generated range; these journeys cover what the user sees.
