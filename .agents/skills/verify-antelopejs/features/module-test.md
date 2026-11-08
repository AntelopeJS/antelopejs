---
covers:
  - src/cli/commands/module/test*.ts
  - src/core/test/**
  - src/core/resolution/stub-interface-runtime.ts
docs:
  - docs/5.cli/4.module.md
  - docs/3.module-development/3.testing.md
---

# Module test

`ajs module test` loads and starts a module with the test configuration `antelopeJs.test` names, then runs its mocha tests.

## Sub-features

- `module-test-pass`: the fixture's test reaches the started module over HTTP: `1 passing`, exit 0.
- `module-test-fail`: error path: a failing expectation exits non-zero with `1 failing`.
- `module-test-file`: `--file test/http.test.js` from the module folder runs only that file.
- `module-test-file-from-parent`: `ajs module test mod --file mod/test/http.test.js` from the parent folder, the form the docs show: `--file` resolves against the current folder.
- `module-test-no-config`: empty path: no `antelopeJs.test` fails and says so.

## How to get to it (user POV)

- `ajs module test`
- `ajs module test ./modules/my-module -f modules/my-module/test/auth.test.ts`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" module-test [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/module-test/<journey>/`.
