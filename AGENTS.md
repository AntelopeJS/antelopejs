# antelopejs

The AntelopeJS core: the runtime that loads modules and wires their interfaces, the `ajs` CLI (`src/core/cli`), and the embedded runtime (`createRuntime`). It is published as `@antelopejs/core`.

## Versioning of @antelopejs/interface-core

The core implements `@antelopejs/interface-core`, and `ImplementInterface` refuses a provider that lacks a declared function. A new interface-core minor may add functions, so the range stays capped below the next minor. To move to a new minor, implement what it adds and raise both bounds in the same release.

## Tests

- Unit suites live in `test/` at the repository root, not under `src/`. They run with mocha through ts-node, and `test/setup.ts` loads first.
- `pnpm test` runs the unit suites under coverage, builds `dist` once, then runs three end-to-end suites against it: `test/embedded` (a host app embedding the runtime), `test/package-consumer` (the packed package as a consumer installs it), and `playground/` (a real project with its own lockfile).
- The CLI picks Unicode or ASCII symbols from `TERM` and the locale, and the output tests expect Unicode. With `TERM=dumb`, which some sandboxes set, eight tests fail on `->` against `→`. Run the tests with `TERM=xterm-256color`.
- Coverage must stay at 90% for lines, functions, branches and statements; `pnpm test` enforces it through `pnpm test:coverage`.

## Shipped files

- `skills/` ships in the npm package and reaches users through `antelopeJs.skills`. When a change alters CLI commands or the module and interface model, update the matching `SKILL.md`.
- `docs/` is the source of framework.antelopejs.com.
- `src/core/embedded/host-module.ts` and `src/core/test/stub-interface.ts` are loaded by path from `dist` at run time. Nothing imports them, so do not delete them as dead code.

## Releases

The release commit writes `CHANGELOG.md`. Upgrade notes for that version follow in a separate `docs(changelog)` pull request, under `### Upgrade notes`.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, run `pnpm run ratchet:update` and commit the lowered file. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                               |
| ------------------------------------------------------------------------------ | ----------------------------------------- |
| Formatting                                                                     | oxfmt                                     |
| Lint findings are errors; no rule warns                                        | oxlint preset                             |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                  |
| Every test asserts                                                             | `antelopejs/require-assertion`            |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`          |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`  |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test` |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`       |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)      |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                      |
| Types check                                                                    | `tsc` (pre-push)                          |
| No dead files, exports, or dependencies                                        | knip                                      |
| Managed files match the pack                                                   | `antelopejs-sync --check`                 |
| A test names the wrong implementation it catches                               | review; no tool                           |

<!-- antelopejs-guardrails:end -->
