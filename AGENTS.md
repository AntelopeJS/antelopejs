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

Finish every change with `pnpm run checks`. It runs typecheck, lint, format, knip, tests, size, ratchet, suppressions, and sync, and prints only what failed. The change is done when it prints no failure.

### While you work

`pnpm run checks` runs every step, so run it once, at the end. While you iterate, run only the check that covers what you changed:

- `pnpm run typecheck` after you change types or signatures.
- `pnpm exec oxlint <files>` and `pnpm exec oxfmt <files>` on the files you changed.
- Run one test file instead of the whole suite. In a module that tests with `ajs module test`, run `pnpm run build`, then `pnpm exec ajs module test . -f dist/<path>.test.js`. Repeat `-f` for more files.

Prove a change works with the verification skill in [`.agents/skills/verify-antelopejs/SKILL.md`](.agents/skills/verify-antelopejs/SKILL.md) before you call it done.

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

A behaviour-preserving cleanup PR shows `antelopejs-api-diff <base-ref>` passing. Published declarations, built runtime exports and the names and signatures a DMS frontend module auto-imports stay unchanged; pass `--allow-added <glob>` (repeatable, e.g. `'**/internal/**'`) to let added entries under that glob pass when their module is `@internal`, and copy its "Added (allowed)" list. Every export under a directory that `dms.frontend.build.ts` auto-imports is published, `@internal` or not; a helper that must stay private goes under `app/build/`. A comment-only PR shows `antelopejs-comment-proof <base-ref>` passing instead of a verifier. Both compare committed HEAD.

Copy the proof's whole output into the PR body, down to its closing `<!-- antelopejs-proof ... -->` line, which stamps the command, base, committed head and a digest. Never type counts by hand. List the lint findings a PR leaves in place by pasting the block `antelopejs-body-check --findings` prints and replacing each `<why>`. `antelopejs-body-check <body.md>` fails an edited or stale proof block, proof output outside one, and a findings line that is not a live diagnostic at HEAD; counts in prose are not checked, so leave them out. The table counts a lint directive once per rule it names, inline directives included.

Pass `--probe <file.cjs>` to api-diff when changing receivers, positional calls, or modules that no published entry reaches. The same captured script runs against both worktree roots, supplied as `argv[2]`, and prints JSON observations. Matching metadata alone does not prove those behaviours.

An entry-only rule exempts only its own module. Add a second module entry rather than exempting another importer. A no-upward rule must reject peers in the same tier as well as higher tiers. Probe the rank decision with an import, not just a reading of the configuration.

Moving a method body into a function keeps how it is called: the same receiver, argument count, read order and laziness.

Verify a boundary against the imports a developer or agent would plausibly write: static and dynamic imports, re-exports, Vue `src`, CSS `@import`, and worker or child-process entries in normally named files. A construction only an evasion would write, an edit to resolution configuration (`package.json` `browser`, `exports`, `main` or `imports`, bundler aliases, tsconfig `paths`), and a difference observable only by patching private fields or internal methods go under Attention and never block. Public API and ordinary subclass behaviour stay part of the contract.

### Suppression budget

`guardrails.suppressions.json` caps the suppressions in authored code, the repository's own files under `.agents/`, `.claude/` and the other agent directories included (`agentFiles`; only what `antelopejs-sync` writes there is skipped): lint directives per rule they name (`*` for none), `@ts-expect-error`, `@ts-ignore` and `SAFETY:` comments, and under `config` each rule a lint config (`oxlint.config.*`, `.oxlintrc.json`, `eslint.config.*`) switches off or to a warning, keyed by rule and `files` glob anchored at the config's directory, so widening or moving a scope is a new ceiling of 0, while narrowing one takes over the room it gives up. Switching a rule off in a config is a suppression too: fix the code its rule reports instead. A suppression over its ceiling fails: fix the code, or remove another suppression of the same kind. A rule that keeps needing suppressions should be changed in the preset. Never raise or remove a number in that file: the check fails a ceiling higher than on the pull request base, and only the operator approves a raise. A directive disabling `anti-slop/require-safety-comment-for-type-assertion` is burn-down debt: remove the assertion, or, where it holds, replace the directive with `SAFETY: <why it holds>`, which takes over its room without a raise. After you remove suppressions, run `pnpm run suppressions:update` and commit the lowered file.

### Debt

`guardrails.ratchet.json` records the lint findings and oversize files this repository already had. Its numbers only go down. After you remove debt, or after a pack upgrade, run `pnpm run ratchet:update` and commit the file: it lowers the numbers and adds only the rules the new pack release enabled, at today's count. Never edit the numbers by hand; CI fails one added or raised against the base. A rule listed there is off for `oxlint`. The ratchet counts it instead, and the pre-commit hook rejects it on every line you add.

### What enforces what

| Rule                                                                           | Enforced by                                         |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Formatting                                                                     | oxfmt                                               |
| Lint findings are errors; no rule warns                                        | oxlint preset                                       |
| Comments are TSDoc, directives, or `SAFETY:` only                              | `antelopejs/no-comments`                            |
| Every test asserts                                                             | `antelopejs/require-assertion`                      |
| Tests read no files outside fixtures, helpers, locales                         | `antelopejs/no-fs-read-in-tests`                    |
| Tests import the code under test from local source, not their own package name | `antelopejs/no-self-import-in-tests`                |
| No assertion that restates a constant                                          | `antelopejs/no-constant-value-assertion`            |
| No test whose only check is "is a function"                                    | `antelopejs/no-typeof-function-only-test`           |
| String-keyed object tables are read through own keys only                      | `antelopejs/no-inherited-key-lookup`                |
| A type guard checks each member it narrows to; keys with `Object.hasOwn`       | `antelopejs/no-presence-only-type-guard`            |
| A type guard checks the nested elements and values it claims                   | review; no tool                                     |
| Every file type-aware lint reads is listed by a tsconfig                       | `antelopejs/require-tsconfig-include`               |
| Params ≤ 5, function ≤ 120 lines, file ≤ 500 lines, depth ≤ 4, complexity ≤ 20 | `eslint/max-*`, `eslint/complexity`                 |
| Cleanup preserves declarations, runtime exports and DMS auto-imports           | `antelopejs-api-diff <base-ref>`                    |
| Comment-only changes preserve JavaScript emit                                  | `antelopejs-comment-proof <base-ref>`               |
| PR-body proof tables are copied unedited from the current head                 | `antelopejs-body-check <body.md>`                   |
| PR-body findings-left lines are live diagnostics at HEAD                       | `antelopejs-body-check <body.md>`                   |
| Receiver, positional and unpublished-module behaviour                          | `antelopejs-api-diff <base-ref> --probe <file.cjs>` |
| Directive and `SAFETY:` reasons are true of the code                           | review; no tool                                     |
| Evasion-only and patched-internal findings go under Attention                  | review; no tool                                     |
| No-upward rules reject same-tier peers                                         | review and import probes                            |
| No `@ts-ignore`                                                                | `typescript/ban-ts-comment`                         |
| No once-used type parameter standing in for `unknown`                          | `typescript/no-unnecessary-type-parameters`         |
| No `any` passed, assigned or returned where a type is declared                 | `typescript/no-unsafe-{argument,assignment,return}` |
| Files ≤ 20,000 bytes, tests and agent files included                           | `antelopejs-check-size` (pre-commit)                |
| Suppressions stay within `guardrails.suppressions.json`                        | `antelopejs-suppressions` (pre-commit, checks)      |
| No lint config switches off a rule to stay under the budget                    | `antelopejs-suppressions` (pre-commit, checks)      |
| No added directive disables the `SAFETY:`, comment or test rules               | `antelopejs-suppressions` (pre-commit, checks)      |
| An added suppression gives a specific reason                                   | `antelopejs-suppressions` (pre-commit, checks)      |
| A directive in a file a change touches suppresses something and gives a reason | `antelopejs-suppressions` (pre-commit, checks)      |
| A block disable is closed in its file                                          | `antelopejs-suppressions` (pre-commit, checks)      |
| Types check                                                                    | `tsc` (pre-push)                                    |
| No dead files, exports, or dependencies                                        | knip                                                |
| Managed files match the pack                                                   | `antelopejs-sync --check`                           |
| A CI gate reads `needs.<id>` only of jobs in its `needs`                       | `antelopejs-sync --check`                           |
| Entry-only rules exempt no tracked outsider                                    | `antelopejs-sync --check`                           |
| A DMS layer's `build/backend-boundary.ts` is the pack's plugin                 | `antelopejs-sync --check`                           |
| A test names the wrong implementation it catches                               | review; no tool                                     |
| Existing debt only shrinks                                                     | `antelopejs-ratchet`                                |

<!-- antelopejs-guardrails:end -->
