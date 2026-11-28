# antelopejs

The AntelopeJS core: the runtime that loads modules and wires their interfaces, the `ajs` CLI (`src/core/cli`), and the embedded runtime (`createRuntime`). It is published as `@antelopejs/core`.

## Versioning of @antelopejs/interface-core

The core implements `@antelopejs/interface-core`, and `ImplementInterface` refuses a provider that lacks a declared function. A new interface-core minor may add functions, so the range stays capped below the next minor. To move to a new minor, implement what it adds and raise both bounds in the same release.

## Tests

- Unit suites live in `test/` at the repository root, not under `src/`. They run with mocha through ts-node, and `test/setup.ts` loads first.
- `pnpm test` runs the unit suites under coverage, builds `dist` once, then runs three end-to-end suites against it: `test/embedded` (a host app embedding the runtime), `test/package-consumer` (the packed package as a consumer installs it), and `playground/` (a real project with its own lockfile).
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

CI runs `pnpm run checks` in full on every pull request and reports what failed. The commit hook formats and lints the staged files. Locally, check only what you touched, one test file and not the suite, as the [`verify-antelopejs`](.agents/skills/verify-antelopejs/SKILL.md) skill says.

### Comments

Say it in code: a constraint in a type, a lint rule or a test, a public item's contract in TSDoc. Other comments are lint directives naming their rules, `@ts-expect-error <reason>`, `SAFETY: <reason>` above a type assertion, and license or tool directives. A reason states what the code does now.

### Tests

Each test names the wrong implementation it fails on, or is deleted. Drive behaviour through the public interface. An invariant over many files is a lint rule.

### Review

No tool checks these:

- A type guard checks the nested elements and values it claims.
- A no-upward import rule rejects same-tier peers; probe it with an import.
- A finding only an evasion or a patched internal can trigger goes under Attention and never blocks.

### Suppressions

`guardrails.suppressions.json` caps lint directives, `@ts-expect-error`, `SAFETY:` comments and rules a lint config turns off. Over a cap, fix the code or remove another suppression of that kind; only the operator raises a number. After removing suppressions, run `pnpm run suppressions:update` and commit the file.

<!-- antelopejs-guardrails:end -->
