---
name: formal-interface-ranges
description: Checks interface package ranges and preloaded-copy rejection against semver through ModuleManager construction. Use when package planning, consumer collection, range validation, or InterfaceResolutionError changes.
---

# Verify interface package ranges

Run this check for changes to the covered functions below, their callers, `semver`, or the fixture and generator files.

## Run the properties

Use Node 24 from `.nvmrc` and install the pinned lockfile dependencies. From the repository root, run this command.

```sh
TERM=xterm-256color FC_SEED=20261028 pnpm exec mocha --no-config --require ts-node/register --require test/setup.ts test/core/module-manager.interface-ranges.test.ts --exit
```

Expect `2 passing` and exit code 0. Both properties also run in `pnpm test`.
`--no-config` prevents `.mocharc.json` from adding every unit test to this focused run.
Change `FC_SEED` to explore another sample. Keep the failing seed and printed counterexample when reporting a failure.
Rerunning the same command with the failing seed reproduces the same generation and shrinking with the pinned dependency version.

## Judge the result

The properties use fast-check 4.10.2 to drive the real TypeScript implementation, rather than a separate model.
This is bounded, generated testing, not an exhaustive proof over every semver string.

1. For each collected consumer, construction reports a range conflict exactly when `semver.validRange` accepts the range and `semver.satisfies` rejects the canonical version with default prerelease rules.
2. Construction throws `InterfaceResolutionError` exactly when a collected consumer conflicts or has a preloaded noncanonical copy, and reports every such consumer with no missing or extra entries.

The first property prevents incompatible interfaces from being shared and valid or ignored declarations from being rejected.
The second prevents construction with an already-loaded incompatible copy and prevents incomplete diagnostics from hiding consumers that need repair.

`collectInterfacePackageConsumers` excludes an empty dependency string before validation.
The properties test that planning rule separately from semver membership by expecting no conflict for `""`.
Whitespace is a collected range, and semver treats it as `*`.
Invalid nonempty ranges remain consumers for preloaded-copy checks, but do not produce range conflicts.
An installed private copy has version `9.9.9`, independently of the canonical version.
Missing copies and symlinks to the canonical copy are valid fixture states.
Loading the canonical copy through a symlink is not a preloaded-copy conflict.

On failure, read the shrunk version, range, consumer copy state, and declaration order as a fixture project.
Check these facts before calling the failure a product bug.

- The generated version is valid semver, including its prerelease and build suffixes.
- The fixture declares the reported range in `dependencies` or `optionalDependencies` and the provider implements `interface-shared`.
- The oracle uses the raw range and default semver options. It does not reuse the implementation's normalized range.
- A `preloaded` fixture really requires a private copy before `addModules`. A `canonical-preloaded` fixture requires the canonical real path instead.
- Assertions compare the error's public fields, not extra internal fields carried by a resolved package.

A malformed fixture, an invalid canonical version, or a wrong assumption about consumer collection is a generator error.
A mismatch after those checks is a finding. Preserve the failing property and counterexample, report the affected consumers, and leave product code unchanged.
An unrelated exception also fails the check. It is not accepted as `InterfaceResolutionError`.

## Bounds and exclusions

Each property runs 250 cases with default seed `20261028`, including its explicit boundary examples.
Version components and numeric prerelease identifiers range from 0 through 4.
Prereleases are absent, numeric, or `alpha`, `beta`, or `rc` followed by a numeric identifier.
Build metadata is absent, `build.0`, or `sha.abc123`.
Ranges include exact versions, `^`, `~`, `>=`, `<`, `=`, minor and major `x` ranges, hyphen ranges, two-arm `||` unions, wildcards, whitespace, empty declarations, and five malformed strings.
Explicit examples cover prerelease admission, build metadata equality, `0.x` caret boundaries, tilde and wildcard boundaries, inclusive hyphen endpoints, unions, and invalid ranges.

The aggregate property generates zero through six consumers, required or optional dependencies, five copy states, and forward or reversed declaration order.
It also has explicit mixed-conflict, preloaded-only, and empty-consumer cases.
Fixtures use one implemented interface package and one provider. They construct real no-op module entry points and always destroy the manager and remove files and cache entries afterward.
The check does not cover multiple competing providers, stub-only canonical selection, multiple package plans, nested interface graphs, arbitrary malformed package manifests, or concurrent module lifecycle operations.

## Coverage record

Last synchronized product commit is `9b812646a162b4601410ac82cded506df571f9fa`.

| File | Functions exercised |
| --- | --- |
| `src/core/modules/module-manager-packages.ts` | `collectInterfacePackageConsumers`, `resolveInterfacePackagePaths`, `resolveImplementedPackage`, `registerInterfacePackage`, `findRangeConflicts`, `findPreloadedCopies`, `validateInterfacePackages` |
| `src/core/modules/module-manager-construction.ts` | `constructAll`, including validation before module construction |
| `src/core/output/interface-resolution-error.ts` | `InterfaceResolutionError` and the exposed conflict records |
| `test/core/module-manager.interface-ranges.test.ts` | The two properties and their independent semver oracle |
| `test/helpers/interface-range-generators.ts` | Input bounds, seed, and run count |
| `test/helpers/interface-range-project.ts` | Public construction fixture, preload setup, and cleanup |
| `test/core/module-manager.fixtures.ts` | Reused `createResolutionFixture`, `createLocalManifest`, and `clearRequireCacheWithin` |

Compare changes since the sync commit against this table before trusting an old pass.
After an intended contract change, update the oracle, generators, and this record together.
Move the sync commit forward only after confirming the properties still describe the changed code and rerunning them, including a scratch break.
Use `pstack:maintain-formal-verification-skill` for changes that landed without this check.

## Confirm the check can fail

On a disposable checkout, apply one scratch break at a time in `src/core/modules/module-manager-packages.ts`, then run the command above.
Keep each break only long enough to observe the failing property. Restore the source before the final passing run.
These breaks were caught at the sync commit.

| Scratch break | Failing observation |
| --- | --- |
| Pass `{ includePrerelease: true }` to `satisfies` | First property fails for canonical `1.2.3-alpha.0`, consumer `*`, because construction no longer rejects it. |
| Drop `!range ||` from the range guard, using `range!` only to keep the scratch variant type-correct | First property fails for canonical `2.0.0`, consumer `not-a-range`, because construction now rejects an ignored range. |
| Pass only `rangeConflicts.slice(0, 1)` into the error | Aggregate property fails for canonical `2.0.0` and two `^1.0.0` consumers because `consumer-1` is missing. |
| Return when `rangeConflicts.length === 0`, ignoring preloaded copies | Aggregate property fails for canonical `1.0.0`, one `*` consumer, and its preloaded `9.9.9` copy because construction succeeds. |

Every scratch run exited 1. After restoration, both properties passed with the same seed.
