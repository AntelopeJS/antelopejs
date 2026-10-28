---
covers:
  - src/cli/commands/module/test*.ts
  - src/core/test/**
  - src/core/resolution/stub-interface-runtime.ts
docs:
  - docs/5.cli/3.module.md
  - docs/3.module-development/3.testing.md
---

# Module test

`ajs module test` loads and starts a module with the test configuration `antelopeJs.test` names, then runs its mocha tests.

## Sub-features

- `module-test-pass`: the fixture's test reaches the started module over HTTP: `1 passing`, exit 0.
- `module-test-fail`: error path: a failing expectation exits non-zero with `1 failing`.
- `module-test-file`: `--file test/http.test.js` from the module folder runs only that file.
- `module-test-file-docs-form`: `ajs module test mod --file test/http.test.js` from the parent folder, the form the docs show.
- `module-test-no-config`: empty path: no `antelopeJs.test` fails and says so.

## How to get to it (user POV)

- `ajs module test`
- `ajs module test ./modules/my-module -f tests/auth.test.ts`

## Driving it with verify-ajs

```bash
node .agents/skills/verify-antelopejs/bin/verify-ajs.mts journey "$RUN" module-test [journey-id...]
```

Each journey's steps, checks and evidence are in `bin/journeys/` and under `$RUN/evidence/module-test/<journey>/`.

## Gotchas

- Finding on main 9b81264: `module-test-file-docs-form` fails. `--file` paths go to mocha unresolved, so they resolve against the current folder, while `docs/5.cli/3.module.md` shows them relative to the module path. Either the code or the page must change; the journey follows the page until then.
