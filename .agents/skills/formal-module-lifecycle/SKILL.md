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

It needs Node 24 and Java 11 or later (`$JAVA`, or `java` on PATH). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256. A run takes about 55 s on 4 cores and explores 3,071,060 states. CI runs it as the `formal-module-lifecycle` job.

- Exit 0 means every rule that held still holds, and each finding still breaks with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks. The script keeps TLC's output in a temporary folder and prints its path.
- Exit 2 means TLC or Java could not run.

## When to run it

Run it when a change touches any file in the coverage record below. A failure makes the Verdict FAIL.

## The rules

| Rule | Plain sentence | On main |
| --- | --- | --- |
| `ReloadNeverOverlaps` | A reload never runs the old and the new generation of a module at once. | holds |
| `NoHalfBuiltModule` | When a running project has no reload in flight, no module of it sits constructed but not started. | holds |
| `LaunchNeverStartsWhileStopping` | A launch never starts its modules once the project began stopping. | holds |
| `DevSurvivesFailedReload` | While a watcher is up, a failed reload and the work it leaves behind never stop the dev process. | holds |
| `NoOrphanGeneration` | Every constructed or running generation is one the project still holds, so a stop or destroy can reach it. | finding F1 |
| `LaunchReadsCurrentConfig` | Every launch, restarts included, loads antelope.config.ts as the file holds it. | finding F2 |
| `ConfigEditsReachProject` | Once the project settles, it holds exactly the modules antelope.config.ts declares. | finding F2, F3 |
| `NoCrashFromStaleWork` | Work a destroyed generation leaves behind never stops the dev process unless the user stopped it. | finding F4 |

`TypeOK` holds too. `check.mjs` records each finding's counterexample length in `FINDINGS`.

## Findings on main

Each finding was replayed against the real code at the sync commit. The replays were scratch scripts and are not committed.

- **F1, generation outside the project (`NoOrphanGeneration`).** Ctrl+C lands while `constructAll` awaits an async `provide` callback (a module that declares `antelopeJs.configVars`). `stopAll` and `destroyAll` find the other modules still `Loaded` and do nothing (`Module.destroy` returns early). Then `clearManagedState` empties `loaded`. The `provide` resolves, `constructReadyModules` constructs those modules, and nothing ever destroys them. In the reload variant, Ctrl+C or a config restart lands while the replacement's `provide` awaits. The replacement then constructs and starts outside every manager. In the replay, a module constructed after Ctrl+C and was never destroyed. In the reload run, the new generation constructed and started after "Stopped the project". After a config restart, that generation runs beside the next launch's generation of the same module. Without an async `provide`, Node runs these steps as microtasks with nothing between them, so the race needs one.
- **F2, restart reads a stale config (`LaunchReadsCurrentConfig`).** `importConfigInput` builds a new jiti instance per call, but jiti answers from the shared `require.cache` while the config's entry is there and loaded (config-loader.ts:42-50, jiti 2.6.1 with `moduleCache` on). The only thing that deletes that entry is `evictModuleFiles` (module-manager-cache.ts:39-51), which `destroyAll` runs for every loaded module, and `reloadLoadedModuleFromSource` for the reloaded one. It deletes only files under the module's folder. So a restart reads the edited file when a loaded module lives at the project root (`path: "."`, the layout the templates use), and reads the first import otherwise. The model has `configOwner`, the module whose folder holds antelope.config.ts, and `Init` lets TLC try both layouts. Replays on the built CLI with `ajs project dev --watch`:
  - Modules in subfolders (`./a`, `./b`): with dev on `{a}`, writing `{a, b}` logged "Configuration file changed, restarting project...", then "Loaded 1 module", and `b` never constructed.
  - Module `a` at the root: writing `{a, b}` gave "Loaded 2 modules", as the parent's template journey saw. Then writing `{b}` gave "Loaded 1 module", and writing `{a, b}` again gave "Loaded 1 module" with only `b` constructed. With the root module removed, nothing evicts the cached config, so every later restart reads `{b}`.
- **F3, edit lost during startup (`ConfigEditsReachProject`).** An edit after `prepareFromConfig` read the config and before `FileWatcher.startWatching` produces no fs.watch event. `watchFile` hashes the already-edited file, so the project runs without the change. In the replay, a module's `construct` wrote `b` into the config during launch, and dev never restarted or loaded `b`.
- **F4, a restart crashes dev (`NoCrashFromStaleWork`).** `restartProject` runs the full shutdown, and that shutdown withdraws the `tolerateInvalidatedModuleWork` tolerance (project-launch.ts:55). The next launch adds a new tolerance only in `setupWatching`. Leftover work of a destroyed generation that fails in between is not tolerated. `shutdownProcess(1)` then interrupts the new launch, and the process exits with code 1. In the replay, a `destroy` callback that leaves a `ListModules()` call on a 0 to 14 ms timer made a config edit end in `process.exit(1)` twice.

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of the three `.tla` files, the map and the chart configs in a scratch folder outside the repo, since it writes its output next to its input. The spec is `ModuleLifecycle.tla`. Use `ModuleLifecycle.map.mjs` as the mapping. The full bound is too large to chart, so chart two views. Use `chart-hmr.cfg` for HMR and Ctrl+C (no config edits), and `chart-config.cfg` for config add/remove and Ctrl+C (no source edits). Pass today's findings as the rules expected to break. A new bug shows as a new numbered path, and a fix shows which bug paths it removes.

## Real bug or modeling error

Replay the counterexample against the code, one action per step, with the coverage record below. A step order is a modeling error when the code cannot produce it. The most likely way is an outside event (Ctrl+C, a file edit, a timer) landing between two steps that only microtasks separate. Then fix the model, keep the rule, and say why. Otherwise reproduce it through an entry point (`launch(...)` with `watch: true`, the built `ajs project dev --watch`, or a signal) and assert only what a user observes.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `\* file.ts:NN` comment on each condition and update its line, then rerun.
- Never weaken or drop a rule to make the check pass. A fixed finding moves out of `FINDINGS` once a replay confirms the fix. A new finding goes into `FINDINGS` with its counterexample length, and into this file with its replay.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `LaunchPrepare`, `EvictConfig` (in `SdClear`, `RlInstall`) | `prepareFromConfig` (src/core/runtime/launch-sequence.ts), `loadProjectConfig` (runtime-bootstrap.ts), `ConfigLoader.load` / `importConfigInput` (src/core/config/config-loader.ts), `evictModuleFiles` (src/core/modules/module-manager-cache.ts) |
| `LaunchAddModules`, `LaunchConstruct`, `LaunchStart`, `LaunchWatch` gates | `runLaunchSteps` (src/core/runtime/launch-steps.ts), `MODULE_STEPS`, `LAUNCH_STEPS` (launch-sequence.ts), `POST_LAUNCH_STEPS` (src/core/repl/project-launch.ts) |
| `ConstructApply`, `LaunchConstructed` | `constructAll`, `constructReadyModules` (src/core/modules/module-manager-construction.ts), `Module.construct` (module.ts), `ModuleLifecycle.construct` (module-lifecycle.ts) |
| `StartApply`, `LaunchStarted` | `startAll`, `startModules` (module-manager-lifecycle.ts), `Module.start`, `ModuleLifecycle.start`, `enqueue` |
| `LaunchWatch`, `LaunchHashConfig`, `LaunchWatching` | `setupWatching`, `keepRunningThroughFailedReloads` (project-launch.ts), `FileWatcher.scanModule`, `watchFile`, `startWatching` (src/core/runtime/watch/file-watcher.ts), `tolerateInvalidatedModuleWork` (runtime-bootstrap.ts) |
| `ConfigEdit`, `ConfigNoticed` | `writeConfig` (src/cli/common.ts), `FileWatcher.handleFileChange`, `handleWatchedFileChange` |
| `RestartRequested`, `RestartLaunches` | `restartUnlessOwnWrite`, `restartProject`, `isRestarting` (project-launch.ts), `getActiveShutdownManager` (src/core/runtime/process-claim.ts), `runLaunchSequence` / `armShutdown` (launch-sequence.ts) |
| `Sigint`, `BeginShutdown` | `ShutdownManager.handleSignal`, `shutdown` (src/core/runtime/shutdown/shutdown-manager.ts) |
| `SdStop`, `SdStopDone`, `SdDestroy`, `SdClear` | `shutdownModules`, `registerModuleShutdownHandler` (process-claim.ts), `stopAll`, `destroyAll`, `getReverseLifecycleModules`, `clearManagedState` (module-manager-lifecycle.ts), `Module.stop`, `Module.destroy`, `ModuleLifecycle.stop`, `destroy` |
| `SdWatcher` | the priority-20 handler in `setupWatching`, `HotReload.clear`, `FileWatcher.stopWatching` |
| `SdRelease`, `SdTolerance`, `SdExit` | `claimProcess`, `releaseActiveShutdownManager` (process-claim.ts), the tolerance handler in `keepRunningThroughFailedReloads`, `executeShutdown` |
| `StaleWorkFails` | `setupProcessHandlers`, `isInvalidatedModuleWork`, `shutdownProcess` (runtime-bootstrap.ts) |
| `SourceEdit`, `FlushStarts`, `ReloadBegins`, `BatchEnds` | `FileWatcher.notifyModuleChange`, `HotReload.queue`, `scheduleFlush`, `flush`, `reloadOne` (src/core/runtime/watch/hot-reload.ts), the reload handler in `setupWatching` |
| `RlManifestLoaded` .. `RlRecovered` | `reloadLoadedModuleFromSource`, `activateReplacement`, `cleanupReplacement`, `recoverPreviousModule` (src/core/runtime/module-reloading.ts), `placeModule`, `replaceLoadedModule` (module-manager-records.ts), `checkReplacement` (module-manager-bindings.ts), `unrequireModuleFiles` (module-manager-cache.ts) |

The sync commit is `9b81264` on AntelopeJS/antelopejs `main`.

## Bounds and what is left out

The check runs with modules `a` and `b` (`a` declared at start), at most 2 config edits (so at most 3 launches) and 1 module source edit, with both config layouts (the config in no module folder, or in `a`'s folder at the project root), which gives 3,071,060 states. The charts use 0 edits with 1 source edit (1,996 states), and 1 edit with 0 source edits (7,198 states). A pass covers these bounds only.

The model leaves out:

- the module interfaces `LoadModule`, `ReloadModule`, `SaveModuleDeclaration` and `RemoveModuleDeclaration`, which a module calls from inside the project;
- `ajs project start`, the REPL, optional modules, and every failure of a first launch (construct, start, download);
- the `destroyAll` of `cleanupFailedLaunch`, which only repeats the shutdown's own `destroyAll`;
- a destroy that fails during shutdown, `pendingCleanup`, start failures and the 120 s start deadline, and a second Ctrl+C;
- the reload's signature check, which skips a reload when no file changed, and directories added or removed under a module;
- `FileWatcher.scanModule` on a missing watch dir. `ajs project modules add --mode local` writes `watchDir: ["src"]`, and a module with no `src/` makes the restarted `setupWatching` reject with `scandir ... ENOENT`, unhandled, so dev exits 1 (reported by the parent's verify journey, replayed here). It is a crash outside the lifecycle orders the model checks.

Every await is a point where another step may run, including Ctrl+C, a file edit, and a timer. Node delivers those only between macrotasks, so the model allows some orders the code cannot produce. Every finding above was replayed, and each replay says which real await it needs.
