---
name: formal-watched-folders
description: Checks the dev --watch FileWatcher over any sequence of folder deletes, recreates, moves and watch failures against a virtual file system with a fake fs.watch. Use when file-watcher.ts, missing-folders.ts or the file-hasher vanished-path rule changes, or when watching a module folder, its ancestors or their recreation changes.
---

# Verify the watched folders

Run this check for changes to the covered functions below, their callers, or the fixture, scenario and test files.

## Run the properties

Use Node 24 from `.nvmrc` and install the pinned lockfile dependencies. From the repository root, run this command.

```sh
TERM=xterm-256color FC_SEED=20261116 pnpm exec mocha --no-config --require ts-node/register --require test/setup.ts test/core/watch/file-watcher.folders.property.test.ts --exit
```

Expect `7 passing` and exit code 0: three incident examples, one property and three open findings. All of them also run in `pnpm test`.
`--no-config` prevents `.mocharc.json` from adding every unit test to this focused run.
Change `FC_SEED` to explore another sample. Keep the failing seed and printed counterexample when reporting a failure. Rerunning the same command with the failing seed reproduces the same generation and shrinking with the pinned dependency version.

## Judge the result

The property drives the real `FileWatcher` over `FolderWorld`, a virtual file system with directory identities like inodes and a fake `fs.watch`. A watcher follows its directory when it is moved, goes silent when it is deleted, and receives `rename` and `change` events a macrotask after each change. Timers are fake, so a retry delay costs no time. This is bounded, generated testing, not an exhaustive proof.

Each scenario scans one module with one to two watch roots, applies operations, lets the watcher settle, and then checks:

1. Each existing watched folder has exactly one open watcher: every directory at or under a scan root, except `node_modules` and `.git`.
2. No deleted or moved-away folder has one. The check compares the directory each open watcher is bound to with the expected list, so a watcher on a deleted folder shows as `gone` and one on a moved folder shows under the parked path.
3. Each scan root that is missing has one watcher on its nearest existing ancestor, which is how a recreated root is found again.
4. An edit in each watched folder reaches the module through `onModuleChanged`.
5. `stopWatching` leaves no open watcher, ancestor watchers included.

A mismatch prints the operations, the open watcher directories and the expected ones. Check these facts before calling it a product bug.

- The oracle derives the expected list from the world's own directories, not from `FileWatcher` state.
- A failure injected with `watchFails` or `watchErrors` hits an ancestor of every scan root, and a scenario holds at most `WATCH_RETRY_LIMIT` of them. More would make `MissingFolders` give up on purpose.
- Each operation is followed by a flush that handles its events, unless the scenario sets `overlap`.

A malformed scenario or a wrong assumption about fake `fs.watch` events is a generator error. A mismatch after those checks is a finding. Preserve the failing counterexample, report it, and leave product code unchanged.

## Open findings

Each finding is excluded from the property and has its own test, which asserts that the scenario still fails. When a finding is fixed its test fails: delete the test and the exclusion together, then rerun the property.

| Finding | Scenario | What the user sees |
| --- | --- | --- |
| F1 | `moveAway` of a folder above a scan root, such as the project folder, with `moveAncestors` | Linux inotify reports the move to the moved folder only. The module folder's watchers follow it to its new path and stay open, and nothing watches the old path once it is recreated. |
| F2 | `delete` then `recreate` of a watched folder before its delete event is handled, with `overlap` | `forgetVanishedDir` asks whether the path exists, finds the recreated folder, and keeps the watcher of the deleted one. The new folder is never watched. |
| F3 | `watchFails` on a watched folder, with `failWatched` | `startWatching` logs the failed `fs.watch` and never retries it, so that folder is unwatched for good. Only ancestor watchers retry. |

## Bounds and exclusions

The property runs 200 cases with default seed `20261116`.
A scenario scans `""`, `src`, `src` and `lib`, or `src/deep` of one module, and holds 1 to 12 operations. The first 0 to 4 run before the watcher starts.
The folders are the project folder, `modules`, the module folder `mod`, `src`, `src/deep`, `lib` and `node_modules`. The operations are `delete`, `recreate`, `moveAway`, `moveBack`, `watchFails`, `watchErrors` and `tick`. `recreate` rebuilds the folder and everything canonical under it, and `moveBack` restores the exact folder that `moveAway` parked.
The check does not cover several modules, `watchFile` watchers, symlinks, Windows semantics (a deleted folder's watcher that keeps reporting), file content beyond whether an edit is seen, or a watched folder's own `error` event.

## Coverage record

Last synchronized product commit is `9ee148828dcaa93ae67e77e34d234e0f48e939f8`.

| File | Functions exercised |
| --- | --- |
| `src/core/runtime/watch/file-watcher.ts` | `scanModule`, `startWatching`, `stopWatching`, the change queue, `followRoot`, `handleNewPath`, `handleRemovedDir`, `pruneDir`, `forgetVanishedDir`, `exploreDir`, `forgetIfVanished` |
| `src/core/runtime/watch/missing-folders.ts` | `MissingFolders.follow`, `forget`, `close`, the retry after a failed ancestor watch |
| `src/core/runtime/watch/file-hasher.ts` | `isVanishedPathError`, the rule that tells a vanished path from a failure |
| `test/core/watch/file-watcher.folders.property.test.ts` | The incident examples, the property and the findings |
| `test/helpers/watch-folder-scenario.ts` | Scenario bounds, seed, run count, oracle and settle loop |
| `test/helpers/watch-folder-world.ts` | The virtual file system and fake `fs.watch` |

Compare changes since the sync commit against this table before trusting an old pass.
After an intended contract change, update the oracle, generators and this record together.
Move the sync commit forward only after confirming the properties still describe the changed code and rerunning them, including a scratch break.

## Confirm the check can fail

On a disposable checkout, apply one scratch break at a time, run the command above, and restore the source with `git checkout src`.
These breaks were caught at the sync commit.

| Scratch break | Failing observation |
| --- | --- |
| In `missing-folders.ts`, replace the `catch` body of `follow` with `return false`, so a failed ancestor watch is not retried (#493) | The #493 example fails because the recreated folder is never found, and the property fails too. |
| In `file-watcher.ts`, delete `await this.forgetVanishedDir(dir);` from `enqueueChange` (#472) | The #472 example fails because the deleted module folder keeps its watcher. |
| In `file-watcher.ts`, delete the `if (this.scanRoots.has(dir)) { this.awaitRoot(dir); }` block of `pruneDir` (#479) | The #479 example fails because the recreated module folder is not watched again. |

Every scratch run exited 1 with the example and the property failing. After restoration, all seven tests passed with the same seed.
