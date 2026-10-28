---
covers:
  - src/core/embedded/**
  - src/index.ts
docs:
  - docs/2.concepts/10.embedded-runtime.md
  - docs/4.guides/7.embedded-runtime.md
---

# Embedded runtime

`createRuntime` from `@antelopejs/core` lets a host application load modules and call interfaces without the CLI.

## Sub-features

- `embedded-start-use-stop`: a host starts the runtime, calls `use('verify-greeter')`, reaches a module over HTTP, keeps its SIGINT listeners, and stops it.
- `embedded-missing-provider`: error path: a host that uses an interface with no provider fails at start.

## How to get to it (user POV)

- A host app: `const runtime = createRuntime({ modules, uses }); await runtime.start(); runtime.use(...)`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" embedded-runtime [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/embedded-runtime/<journey>/`.

## Gotchas

- The host script is `fixtures/hosts/embedded-host.mjs`, run with the built `dist/index.js`, the file a consumer imports.
