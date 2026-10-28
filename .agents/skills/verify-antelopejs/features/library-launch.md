---
covers:
  - src/index.ts
  - src/core/repl/project-launch.ts
  - src/core/repl/launch.ts
  - src/core/build/**
docs:
  - docs/2.concepts/7.runtime.md
---

# Library launch

`launch`, `build` and `launchFromBuild`, exported by `@antelopejs/core`, run a project from code.

## Sub-features

- `launch-build-from-build`: `launch` serves, `build` writes the artifact, `launchFromBuild` serves from it; each stops with `stopAll` and `destroyAll`; the default export is `launch`.

## How to get to it (user POV)

- `require('@antelopejs/core').launch(projectFolder)`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" library-launch [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/library-launch/<journey>/`.

## Gotchas

- The host loads `dist/index.js` with `require`, as a CommonJS consumer does; the named and default `launch` must be the same function.
