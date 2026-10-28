---
covers:
docs:
  - docs/1.get-started/3.quick-start.md
---

# Smoke

The fixed journey every verdict runs, whatever the diff touches: create a project from a template, run it, call its module over HTTP, stop it.

## Sub-features

- `smoke`: `ajs project init` with flags, then `ajs project dev` in the background, `GET /` on the fixture module, SIGINT by recorded PID, exit code 130, the port refused afterwards.

## How to get to it (user POV)

- `ajs project init app --template 'Verify HTTP' --pm pnpm --no-git-init`
- `ajs project dev` in the project, then the module's HTTP endpoint, then Ctrl+C.

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" smoke [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/smoke/<journey>/`.

## Gotchas

- The smoke feature covers no glob: it runs for every diff, so it never marks a file as mapped.
- A smoke FAIL makes the verdict FAIL even when every touched feature passes.
