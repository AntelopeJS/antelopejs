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
- `src/index.ts` exports `launch` both by name and as the package default, and both are published API. Knip has no per-export suppression, so `knip.config.ts` turns its `duplicates` check off.

## Releases

The release commit writes `CHANGELOG.md`. release-it and changelogen rewrite it without running the formatter, so `oxfmt.config.ts` keeps Markdown out of the format check. Upgrade notes for that version follow in a separate `docs(changelog)` pull request, under `### Upgrade notes`.

<!-- antelopejs-guardrails:start -->
<!-- Managed by @antelopejs/tooling-configs. `antelopejs-sync` rewrites everything between these markers; write repository-specific guidance outside them. -->

## Guardrails

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, and sync, and prints only what failed. The change is done when it prints no failure.

The tools enforce most rules, listed in the table at the end. The sections below hold the rules no tool checks.

### Comments

Say it in code. A constraint belongs in a type, a lint rule, or a test. A public item's contract belongs in TSDoc (`/** */`) on that item. The only other comments are lint directives that name their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, `/*!` license headers, and bundler or formatter directives.

Before suppressing a type rule, try inference or a type derived from its owner with `Parameters`, `ReturnType`, or indexed access. A private alias can still appear in a published declaration. Keep a suppression only after checking the published contract and the unchecked boundary it protects.

Check each directive reason against the current line and its callers. Returning a value is not the same as awaiting and discarding it. A reason must describe what the code does now.

### Tests

Hold every test you write or keep to this checklist:

- Name the wrong implementation this test fails on. A test with no answer is deleted, not kept.
- No test reads the file it tests. Drive the behaviour through the public interface.
- An invariant over many files is a lint rule, not a test.

### Cleanup proof

A behaviour-preserving cleanup PR shows `antelopejs-api-diff <base-ref>` passing. Published declarations and built runtime exports stay unchanged. A comment-only PR shows `antelopejs-comment-proof <base-ref>` passing instead of a verifier. Both compare committed HEAD.

Copy counts from the proof's base and HEAD table. Never type counts by hand. Keep the command and the committed head beside the copied output. Directive lines are not individual suppressed rules.

Pass `--probe <file.cjs>` to api-diff when changing receivers, positional calls, or modules that no published entry reaches. The same captured script runs against both worktree roots, supplied as `argv[2]`, and prints JSON observations. Matching metadata alone does not prove those behaviours.

An entry-only rule exempts only its own module. Add a second module entry rather than exempting another importer. A no-upward rule must reject peers in the same tier as well as higher tiers. Probe the rank decision with an import, not just a reading of the configuration.

### What enforces what

| Rule                                                                           | Enforced by                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Formatting                                                                     | oxfmt                                               |
| Lint findings are errors; no rule warns                                        | oxlint preset                                       |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                            |
| Every test asserts                                                             | `antelopejs/require-assertion`                      |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`                    |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`            |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test`           |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`                 |
| Cleanup preserves declarations and built runtime export metadata               | `antelopejs-api-diff <base-ref>`                    |
| Comment-only changes preserve JavaScript emit                                  | `antelopejs-comment-proof <base-ref>`               |
| PR-body counts come from tracked code files                                    | api-diff and comment-proof tables                   |
| Receiver, positional and unpublished-module behaviour                          | `antelopejs-api-diff <base-ref> --probe <file.cjs>` |
| Type suppressions and directive reasons are justified                          | review; no tool                                     |
| No-upward rules reject same-tier peers                                         | review and import probes                            |
| Files ≤ 20,000 bytes, tests included                                           | `antelopejs-check-size` (pre-commit)                |
| Types check                                                                    | `tsc` (pre-push)                                    |
| No dead files, exports, or dependencies                                        | knip                                                |
| Managed files match the pack                                                   | `antelopejs-sync --check`                           |
| Entry-only rules exempt no tracked outsider                                    | `antelopejs-sync --check`                           |
| A test names the wrong implementation it catches                               | review; no tool                                     |

<!-- antelopejs-guardrails:end -->
