---
name: formal-build-start
description: TLA+ model of `ajs project build` rewriting `.antelope/build/build.json` and pruning the module cache while `ajs project start` reads it and leases the module folders it names, checked with TLC. Use when a change touches a file in its coverage record, or when a change to build.json, the cache prune or the start claims needs proof that a start never loses its build.
---

# Formal check: build rewriting build.json while start leases

The spec models two concurrent builds that each download a module folder, write `build.json` and prune the cache, and two starts that read `build.json`, lease the folders it names, wait for a prune, and read it again. TLC checks every interleaving within the bounds below. `BuildStart.tla` is the model.

## Run it

```sh
node .agents/skills/formal-build-start/check.mjs
```

It needs Node 24, `pnpm install` done, and Java 11 or later from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image. The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal`. A run of the four configurations takes about 15 s on 4 cores and explores up to 1,100,000 states each. CI runs it as the `formal-build-start` job.

- Exit 0 means every rule held or broke as `RUNS` in `check.mjs` records, each finding with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks.
- Exit 2 means TLC or Java could not run.

## The rules

| Rule | Plain sentence | On main |
| --- | --- | --- |
| `StartRunsValidBuild` | A start that runs a build has every folder of it in the cache, and its own lease names it. | holds |
| `StartNeverFailsOnAValidBuild` | A start never fails while a valid build exists. Build 1 is in place from the start, so no start fails. | holds |

`TypeOK` holds too.

## Configurations

| Configuration | What it models | Result |
| --- | --- | --- |
| `BuildStart` | The code on main: `build.json` replaced by a rename (#501), `start` reading it again after its claims (#497). | Every rule holds. |
| `BuildStartNoReread` | Main without the second read, as before #497. | `StartNeverFailsOnAValidBuild` breaks at 13 states: a start reads build 1, a build writes build 2 and prunes folder 1 before the start leases it, and the start runs the missing folder. |
| `BuildStartNonAtomicWrite` | Main with `build.json` removed and written again, as before #501. | `StartNeverFailsOnAValidBuild` breaks at 4 states: a start reads while the file is missing. |
| `BuildStartBefore497` | Neither fix, the code the property is judged on. | The same break at 4 states. |

`StartRunsValidBuild` holds in all four: a start that fails never runs the missing folder, it stops with "Module not found ... rebuild".

A configuration that holds beside a twin that breaks is the proof that the check fails on the code before the fix: `BuildStart` and `BuildStartNoReread` differ in the second read alone.

## Findings on main

None. Every rule holds.

## Real bug or modeling error

Replay the counterexample against the real code, with a build and a prune in a child process as `test/core/runtime/start-build-race.test.ts` does. A step order is a modeling error when the code cannot produce it. Then fix the model, keep the rule, and say why. Otherwise it is a finding: keep the rule, record the counterexample length in `RUNS`, and report it here and in the pull request.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `\* file.ts:name` comment on each, and rerun.
- Never weaken or drop a rule to make the check pass. A fixed finding leaves `RUNS` once a replay confirms the fix.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `Download` | `ModuleCache.getFolder`, `claimFolder` (src/core/modules/module-cache.ts): the build's own lease on the folder it loads |
| `Write`, `Rewrite` | `writeBuildArtifact` (src/core/modules/build-artifact.ts), `writeProjectBuildArtifact` (src/core/runtime/build-runtime.ts), `build` (src/core/build/index.ts) |
| `PruneLock`, `ReadManifest`, `ReadLeases`, `ReadKeep`, `Trash`, `Unlock` | `ModuleCache.prune`, `moveUnusedToTrash`, `trashEntries` (module-cache.ts), `pruneModuleCache`, `readBuildKeep` (src/core/runtime/cache-pruning.ts) |
| `Exit` | the end of the building process, which drops its lease |
| `Read`, `Reread` | `readRefreshedBuild`, `readBuildArtifactOrThrow` (src/core/runtime/build-refresh.ts, build-runtime.ts), `readNewerBuild`, `claimCurrentBuild` (src/core/runtime/launch-sequence.ts) |
| `Claim`, `Wait` | `claimBuiltFolders` (launch-sequence.ts), `ModuleCache.claimFolder`, `claim` |
| `Run` | `mapArtifactModuleEntries` and the load of each module folder |

The sync commit is `9ee148828dcaa93ae67e77e34d234e0f48e939f8` on AntelopeJS/antelopejs `next`.

## Bounds and what is left out

Build 1 in place, two builders (builds 2 and 3) and two starts. A pass covers these bounds only.

The model leaves out:

- a first build: a start with no `build.json` fails with "no build" by design, and every start here has build 1 to find;
- the build pins: a pin names the project's own `build.json`, which `ReadKeep` already reads;
- the prune lock's wait in `claim` (the claim waits while a prune holds the lock): the model checks it as `Wait`, but no race of these two processes needs it, because a prune only follows its own `build.json` write; a dev run that prunes without a build is outside the model;
- the stale temporary files of `build.json` and the failed or half-written reads of its content, except as the missing file of the removed-and-written variant;
- the `--refresh-config` variant, which refreshes the same artifact in memory.
