---
name: formal-module-lifecycle
description: TLA+ model of the module-manager lifecycle under `ajs project dev --watch` (HMR reload, failed reload, Ctrl+C stop, module add/remove through antelope.config.ts), checked with TLC. Use when a change touches a file in its coverage record, or when a change to reloading, restarting, launching or shutting down needs proof that it breaks no lifecycle rule.
---

# Formal check: module-manager lifecycle

The TLA+ spec models what `ajs project dev --watch` does to module generations: the launch, HMR reloads (`HotReload` and `reloadLoadedModuleFromSource`), the config watcher's `restartProject`, Ctrl+C, and the `ShutdownManager` handlers. `ajs project modules add` and `remove` reach a running dev only through that config watcher. Both write antelope.config.ts with `writeConfig`, and the running process restarts. TLC checks every order of those steps within the bounds below. `ModuleLifecycleState.tla` holds the variables and `Init`, `ModuleLifecycleLaunch.tla` the launch, config restarts and shutdown, and `ModuleLifecycle.tla` hot reload, `Next` and the rules. Each file stays under the repo's 20,000-byte limit.

## Run it

```sh
node .agents/skills/formal-module-lifecycle/check.mjs
```

It needs Node 24, `pnpm install` done (the runner comes from `@antelopejs/tooling-configs/formal`), and Java 11 or later from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image (set `TLC_DOCKER_PREFIX` to name the containers). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256. A run takes about 10 s on 4 cores and explores 754,476 states. CI runs it as the `formal-module-lifecycle` job.

- Exit 0 means every rule that held still holds, and each finding still breaks with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks. The script keeps TLC's output in a temporary folder and prints its path.
- Exit 2 means TLC or Java could not run.

## When to run it

Run it when a change touches any file in the coverage record below. A changed rule (exit 1) makes the Verdict FAIL. The recorded findings fail it only when the diff changes what the covered code does, which `verify-ajs formal` decides by comparing the covered files' JavaScript statements on the base and on HEAD (`verify-antelopejs` verdict rule 5).

## The rules

| Rule | Plain sentence | On main |
| --- | --- | --- |
| `ReloadNeverOverlaps` | A reload never runs the old and the new generation of a module at once. | holds |
| `NoHalfBuiltModule` | When a running project has no reload in flight, no module of it sits constructed but not started. | holds |
| `LaunchNeverStartsWhileStopping` | A launch never starts its modules once the project began stopping. | holds |
| `DevSurvivesFailedReload` | While a watcher is up, a failed reload and the work it leaves behind never stop the dev process. | holds |
| `NoCrashFromStaleWork` | Work a destroyed generation leaves behind never stops the dev process unless the user stopped it. | holds |
| `NoOrphanGeneration` | Every constructed or running generation is one the project still holds, so a stop or destroy can reach it. | holds (F1 fixed) |
| `LaunchReadsCurrentConfig` | Every launch, restarts included, loads antelope.config.ts as the file holds it. | holds (F2 fixed) |
| `ConfigEditsReachProject` | Once the project settles, it holds exactly the modules antelope.config.ts declares. | holds (F2 fixed) |

`TypeOK` holds too. `check.mjs` records each finding's counterexample length in `FINDINGS`, which is empty while every rule holds.

## Findings on main

Each finding was replayed against the real code at the sync commit. The replays were scratch scripts and are not committed.

- **F1, generation outside the project (`NoOrphanGeneration`), fixed.** Ctrl+C landed while `constructAll` awaited an async `provide` callback (a module that declares `antelopeJs.configVars`). `destroyAll` passed over the modules still `Loaded`, `clearManagedState` emptied `loaded`, and when the `provide` resolved those modules constructed and nothing destroyed them. In the reload variant, a replacement whose `provide` awaited constructed and started outside every manager. Now `stopAll` and `destroyAll` close the manager before their first await, then wait for the constructs already past their check. `constructAll`, `constructModules`, `provideEntry` and `constructEntry` do nothing on a closed manager, so a replacement installed during the shutdown is covered too. `Closed` models that flag, and `ConstructApply` and `RlConstruct` check it. `test/core/module-manager.shutdown-race.test.ts` replays both variants, and a `provide` that resolves as the shutdown starts, through `constructAll` and `constructModules` with the shutdown handler's `stopAll` then `destroyAll`.
- **F2, restart reads a stale config (`LaunchReadsCurrentConfig`, `ConfigEditsReachProject`), fixed (#244).** `ConfigLoader.load` imported antelope.config.ts through jiti with its module cache on, so a restart got the first import back from `require.cache` unless `evictModuleFiles` had dropped the config's entry, which it did only when a loaded module lived at the project root. With modules in `./a` and `./b`, adding `b` while dev ran restarted the project with `a` alone. Now `ConfigLoader.load` passes `fresh`, and `importConfigInput` turns jiti's module cache off, so every load reads the file as it is (config-loader.ts:115, ts-config-file.ts). `LaunchPrepare` reads `declared`, and the model no longer tracks a jiti cache or which module folder holds the config. `test/integration/config-edit-during-launch.test.ts` restarts dev on that `./a`, `./b` layout and starts `b`, `test/core/config/config-loader.reload.test.ts` reads the modules one edit of the file added and removed, and the verify journey `project-dev/dev-readd-root-module` re-adds the root module (`path: "."`) while dev runs and restarts with it loaded.
- **F3, edit lost during startup, fixed (#248).** An edit after `prepareFromConfig` read the config and before `FileWatcher.startWatching` produced no fs.watch event, and `watchFile` hashed the already-edited file, so the project ran without the change. `prepareFromConfig` now hashes antelope.config.ts and `.env` before it loads them, `watchFile` keeps that hash, and `startWatching` checks each watched file against it once its directory is watched. `LaunchPrepare` sets `cfgHash` and `LaunchWatching` raises `cfgEvent`. `test/integration/config-edit-during-launch.test.ts` replays it: a module's `construct` writes `b` into the config during launch, and dev restarts and starts `b`.

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of the three `.tla` files, the map and the chart configs in a scratch folder outside the repo, since it writes its output next to its input. The spec is `ModuleLifecycle.tla`. Use `ModuleLifecycle.map.mjs` as the mapping. The full bound is too large to chart, so chart two views. Use `chart-hmr.cfg` for HMR and Ctrl+C (no config edits), and `chart-config.cfg` for config add/remove and Ctrl+C (no source edits). Pass today's findings, if any, as the rules expected to break. A new bug shows as a new numbered path, and a fix shows which bug paths it removes.

## Real bug or modeling error

Replay the counterexample against the code, one action per step, with the coverage record below. A step order is a modeling error when the code cannot produce it. The most likely way is an outside event (Ctrl+C, a file edit, a timer) landing between two steps that only microtasks separate. Then fix the model, keep the rule, and say why. Otherwise reproduce it through an entry point (`launch(...)` with `watch: true`, the built `ajs project dev --watch`, or a signal) and assert only what a user observes.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `\* file.ts:NN` comment on each condition and update its line, then rerun.
- Never weaken or drop a rule to make the check pass. A fixed finding moves out of `FINDINGS` once a replay confirms the fix. A new finding goes into `FINDINGS` with its counterexample length, and into this file with its replay.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `LaunchPrepare` | `prepareFromConfig`, `hashRestartFiles` (src/core/runtime/launch-sequence.ts), `loadProjectConfig` (runtime-bootstrap.ts), `ConfigLoader.load` (src/core/config/config-loader.ts), `loadTsConfigFile` / `importConfigInput` (src/core/config/ts-config-file.ts) |
| `LaunchAddModules`, `LaunchConstruct`, `LaunchStart`, `LaunchWatch` gates | `runLaunchSteps` (src/core/runtime/launch-steps.ts), `MODULE_STEPS`, `LAUNCH_STEPS` (launch-sequence.ts), `POST_LAUNCH_STEPS` (src/core/repl/project-launch.ts) |
| `ConstructApply`, `LaunchConstructed` | `constructAll`, `constructReadyModules` (src/core/modules/module-manager-construction.ts), `Module.construct` (module.ts), `ModuleLifecycle.construct` (module-lifecycle.ts) |
| `StartApply`, `LaunchStarted` | `startAll`, `startModules` (module-manager-lifecycle.ts), `Module.start`, `ModuleLifecycle.start`, `enqueue` |
| `LaunchWatch`, `LaunchHashConfig`, `LaunchWatching` | `setupWatching`, `keepRunningThroughFailedReloads` (project-launch.ts), `FileWatcher.scanModule`, `watchFile`, `startWatching`, `checkWatchedFilesIn` (src/core/runtime/watch/file-watcher.ts), `tolerateInvalidatedModuleWork` (runtime-bootstrap.ts) |
| `LaunchReturns` | `startProject`, `POST_LAUNCH_STEPS` (project-launch.ts), `runLaunchSteps`, `throwIfStopping` (launch-steps.ts) |
| `ConfigEdit`, `ConfigNoticed` | `writeConfig` (src/cli/common.ts), `FileWatcher.handleFileChange`, `handleWatchedFileChange` |
| `RestartRequested`, `RestartLaunches` | `restartUnlessOwnWrite`, `restartProject`, `isRestarting` (project-launch.ts), `getActiveShutdownManager` (src/core/runtime/process-claim.ts), `ShutdownManager.active`, `runLaunchSequence` / `armShutdown` (launch-sequence.ts) |
| `RestartInterrupted` | the `catch` and `finally` of `restartProject`, `LaunchInterruptedError` (launch-steps.ts), `cleanupFailedLaunch` (launch-sequence.ts) |
| `Sigint`, `BeginShutdown` | `ShutdownManager.handleSignal`, `shutdown` (src/core/runtime/shutdown/shutdown-manager.ts) |
| `SdStop`, `SdStopDone`, `SdDestroy`, `SdClear` | `shutdownModules`, `registerModuleShutdownHandler` (process-claim.ts), `stopAll`, `destroyAll`, `getReverseLifecycleModules`, `clearManagedState` (module-manager-lifecycle.ts), `Module.stop`, `Module.destroy`, `ModuleLifecycle.stop`, `destroy` |
| `SdWatcher` | the priority-20 handler in `setupWatching`, `HotReload.clear`, `FileWatcher.stopWatching` |
| `SdRelease`, `SdTolerance`, `SdExit` | `claimProcess`, `releaseActiveShutdownManager` (process-claim.ts), the tolerance handler in `keepRunningThroughFailedReloads`, `executeShutdown` |
| `StaleWorkFails` | `setupProcessHandlers`, `isInvalidatedModuleWork`, `shutdownProcess` (runtime-bootstrap.ts) |
| `SourceEdit`, `FlushStarts`, `ReloadBegins`, `BatchEnds` | `FileWatcher.notifyModuleChange`, `HotReload.queue`, `scheduleFlush`, `flush`, `reloadOne` (src/core/runtime/watch/hot-reload.ts), the reload handler in `setupWatching` |
| `RlManifestLoaded` .. `RlRecovered` | `reloadLoadedModuleFromSource`, `activateReplacement`, `cleanupReplacement`, `recoverPreviousModule` (src/core/runtime/module-reloading.ts), `placeModule`, `replaceLoadedModule` (module-manager-records.ts), `checkReplacement` (module-manager-bindings.ts), `unrequireModuleFiles` (module-manager-cache.ts) |

The sync commit is `4299737` on AntelopeJS/antelopejs `main`. Every `\* file.ts:NN` comment cites the code at that commit.

## Bounds and what is left out

The check runs with modules `a` and `b` (`a` declared at start), at most 2 config edits (so at most 3 launches) and 1 module source edit, which gives 754,476 states. The charts use 0 edits with 1 source edit (2,757 states), and 1 edit with 0 source edits (2,825 states). Within these bounds only Ctrl+C interrupts the launch of a restart, and Ctrl+C exits the process, so `RestartInterrupted` never runs. It stays in the model because `restartProject` ends that way on `main`. A pass covers these bounds only.

The model leaves out:

- the module interfaces `LoadModule`, `ReloadModule`, `SaveModuleDeclaration` and `RemoveModuleDeclaration`, which a module calls from inside the project;
- `ajs project start`, the REPL, optional modules, and every failure of a first launch (construct, start, download);
- the `destroyAll` of `cleanupFailedLaunch`, which only repeats the shutdown's own `destroyAll`;
- a destroy that fails during shutdown, `pendingCleanup`, start failures and the 120 s start deadline, and a second Ctrl+C;
- the reload's signature check, which skips a reload when no file changed, and directories added or removed under a module;
- files that antelope.config.ts imports: jiti's module cache is off for the config, but Node's own loader still caches an imported `.json`, `.cjs`, CommonJS `.js` or `.mjs` file across restarts, and the watcher does not watch them;
- `FileWatcher.scanModule` on a missing watch dir, such as the `src` that `ajs project modules add --mode local` writes for a module with no `src/`. The scan skips it and watches the module's other watch dirs, outside the lifecycle orders the model checks.

Every await is a point where another step may run, including Ctrl+C, a file edit, and a timer. Node delivers those only between macrotasks, so the model allows some orders the code cannot produce. It excludes one: `ConfigNoticed` never runs while its launch is in `postLaunch`, because the fs reads of `handleWatchedFileChange` resolve in a later poll phase than the `setImmediate` that `LaunchReturns` awaits. A signal can still land there. Every finding above was replayed, and each replay says which real await it needs.
