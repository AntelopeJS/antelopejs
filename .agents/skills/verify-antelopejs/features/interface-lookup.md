---
covers:
  - src/core/downloaders/package.ts
  - src/core/modules/cache-manifest.ts
  - src/core/modules/module-cache.ts
  - src/core/runtime/cache-pruning.ts
docs:
  - docs/5.cli/4.module-cache.md
---

# Interface lookup

The cache that `ajs project dev` and `ajs project build` fill is the source the interface resolver of the agent-skills plugin reads offline, behind `/antelopejs:interface`. `.antelope/cache/<package>@<version>` holds one folder per version of a module, so a lookup that names a version must read that folder.

## Sub-features

- `lookup-pinned-cached-version`: with `@verify/module-billing` 1.0.0 built in `app` and 2.0.0 built in a second project that shares the cache of `app` through an absolute `cacheFolder`, the cache holds both versions, each kept by its build pin. `resolve-interface.mjs show <package>@<version>/interface --offline --json` reports each pinned version and the cache folder it read.

## How to get to it (user POV)

- Ask the agent for an interface contract (`/antelopejs:interface @acme/module-billing@2.0.0/interface`) in a project whose cache the CLI filled.

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" interface-lookup [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/interface-lookup/<journey>/`.

## Gotchas

- The resolver is not part of this repository. The journey clones `https://github.com/AntelopeJS/agent-skills.git` once into `~/.cache/verify-antelopejs/agent-skills.git`, fetches `main` on each run, and reads the resolver from a worktree of that commit. Set `AJS_VERIFY_AGENT_SKILLS_REF` to another ref, such as the parent of agent-skills#76 (`1fd50e186^`), to see the journey fail on the resolver that read `.antelope/cache/<package>` without its version. The fetch needs the network; the lookups run with `--offline`.
- The modules come from the run's local registry, the same one the `project-module-locks` journeys use.
- The journey asserts only what the resolver prints for the version it was asked for, never which version it would pick for an unpinned name.
