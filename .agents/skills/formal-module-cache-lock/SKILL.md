---
name: formal-module-cache-lock
description: TLA+ model of the module cache lock protocol (mkdir lock, staged owner write, takeover of an exited, silent or ownerless lock, guarded download steps, prune), checked with TLC against processes that race, crash and stall. Use when a change touches a file in its coverage record, or when a change to a cache lock, a download or a prune needs proof that one process at a time writes a cache folder.
---

# Formal check: module cache lock

The spec models what several processes do to one lock of a module cache (`.downloads/<entry>.lock`, `.prune.lock`, `.manifest.lock`): taking it, holding it while a download or a prune writes the guarded folder, waiting for it, taking it over, and releasing it. `CacheLock.tla` is the model. TLC checks every interleaving of three processes that may crash, stall or meet a full disk, within the bounds below.

## Run it

```sh
node .agents/skills/formal-module-cache-lock/check.mjs
```

It needs Node 24, `pnpm install` done (the runner comes from `@antelopejs/tooling-configs/formal`), and Java 11 or later from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image. The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` and checks its SHA-256. A run of the nine configurations takes about a minute on 4 cores and explores up to 800,000 states each. CI runs it as the `formal-module-cache-lock` job.

- Exit 0 means every rule held or broke as `RUNS` in `check.mjs` records, each finding with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks.
- Exit 2 means TLC or Java could not run.

## The rules

| Rule | Plain sentence | On main |
| --- | --- | --- |
| `SingleWriter` | At most one live process runs a step that writes the guarded folder at a time. | breaks: F1, F2 |
| `NoLiveTakeover` | A takeover removes only a lock folder whose holder exited or lapsed, never one a live process holds. | breaks: F1 |
| `NoCleanupOfLiveOwner` | A failed owner write or rename never removes a folder whose `owner.json` names a live process. | breaks: F3 |
| `NoCleanupOfLiveFolder` | A refused owner write never removes the folder a live process is creating. | holds |
| `NoCleanupAfterMiss` | A failed owner rename never removes the folder a live process holds or is creating. | breaks: F3 |
| `NoForeignRelease` | A release removes only a folder that still holds its own token. | breaks, a consequence of F1 and F2 |

`TypeOK` holds in every configuration.

## Configurations

Each `.cfg` sets the bounds and four switches that turn one behaviour of the code off. `check.mjs` runs all of them.

| Configuration | What it models | Result |
| --- | --- | --- |
| `CacheLock` | The code on main, with silent holders and creators. | F1, F2 and F3 break the rules above. |
| `CacheLockCrashOnly` | Main with no silent process, so F1 stands alone. | F1 at 20 states; its consequences longer. |
| `CacheLockSerialRemoval` | Main with each takeover and cleanup reading the owner and removing the folder as one step, and no silent process. | Every rule holds. |
| `CacheLockHolderStall` | The same, with a holder that may go silent between steps. | Every rule holds: the check before each step stops a holder whose lock was taken. |
| `CacheLockCreatorStall` | The same, with a creator that may go silent between its `mkdir` and its owner. | F2 and F3 only. |
| `CacheLockBefore499` | Holder stall, and a download that does not check its token before each step (before #499 and #503). | `SingleWriter` breaks. |
| `CacheLockBefore500` | Creator stall, and an owner written in the folder, the folder removed unconditionally when that write fails (before #500). | `NoCleanupOfLiveOwner` and `NoCleanupOfLiveFolder` break. |
| `CacheLockBefore504` | Creator stall, with #500 but the owner written in the folder (before #504). | `NoCleanupOfLiveFolder` breaks, `NoCleanupOfLiveOwner` holds. |
| `CacheLockBefore494` | Creator stall, with all three of #499 and #503, #500 and #504 off, the code that #494 was reviewed on. | Every cleanup rule and `SingleWriter` break. |

A configuration that holds where its `Before` twin breaks is the proof that the check fails on the code before the fix: `CacheLockHolderStall` and `CacheLockBefore499` differ in the step guard alone, `CacheLockCreatorStall` and `CacheLockBefore504` in where the owner is written alone.

## Findings on main

Each finding was replayed against the real code at the sync commit with a scratch script that gates one file-system call. The scripts are not committed.

- **F1, two waiters take the lock of an exited owner (`NoLiveTakeover`, `SingleWriter`), open.** `removeIfHeldBy` reads `owner.json` and then removes the folder. Waiters A and B both read the token of the exited owner. A removes the folder and takes the lock. B removes the folder A just took, and takes it too. A, alive and holding, then fails its next check with "Another process took over the download lock", or runs a step beside B when its check had already passed. The replay held B's `rm` until A held the lock: A held it, then lost it, and B acquired it. The docs list the 60 s races of a silent or ownerless lock, never this one, which needs no clock and no stall.
- **F2, a creator that stalled past 60 s replaces another's owner (`SingleWriter`), listed in docs/5.cli/4.module-cache.md.** A creator stalls between `mkdir` and its owner rename. A waiter removes its folder, another process takes the lock and holds it. The creator resumes and its rename replaces the other's `owner.json`, so both pass their checks until the next heartbeat or check. The replay confirmed `isHeld` true for the creator and false for the holder.
- **F3, a failed rename removes a folder another process just made (`NoCleanupAfterMiss`, `NoCleanupOfLiveOwner`), listed in docs/5.cli/4.module-cache.md under "A process that cannot move its owner".** The rename of a creator whose folder was removed fails, and its cleanup reads `owner.json` as missing and removes the folder another process made meanwhile; in the non-atomic cleanup the other process may already have written its owner.

## Real bug or modeling error

Replay the counterexample against the real code with a file system that holds one call back, as above. A step order is a modeling error when the code cannot produce it. Then fix the model, keep the rule, and say why. Otherwise it is a finding: keep the rule, record the counterexample length in `RUNS`, and report it here and in the pull request.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `\* file.ts:name` comment on each, and rerun.
- Never weaken or drop a rule to make the check pass. A fixed finding leaves `RUNS` once a replay confirms the fix.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `Start`, `Stage`, `Mkdir`, `Rename` | `tryAcquireCacheLock`, `acquireCacheLock`, `tryCreateLock`, `createLockFolder` (src/core/modules/cache-lock.ts) |
| `CleanRead`, `CleanRm` | `removeUnlessOwnedByAnother`, `removeLockFolder` |
| `Read`, `TakeCheck`, `TakeRm` | `readOwner`, `holdsToken`, `removeIfHeldBy`, `hasExited` |
| `Wait`, `AbandonRm`, `Lapse` | `waitWhileCacheLocked`, `isAbandoned`, `isSameHold` |
| `BeginStep`, `EndStep` | `ModuleCache.ensureDownloadLockHeld`, `getFolder`, `commitVersion` (src/core/modules/module-cache.ts), `underDownloadLock` (src/core/downloaders/utils.ts), the git and package downloaders (src/core/downloaders/git.ts, package.ts) |
| `Finish`, `ReleaseRead`, `ReleaseRm` | `CacheLock.release`, `ModuleCache.withDownloadLock`, `ModuleCache.prune` |
| `Stall`, `Resume`, `Crash` | the heartbeat of `startHeartbeat`, a process that exits, `isLiveProcess` (src/core/modules/cache-leases.ts) |

The sync commit is `9ee148828dcaa93ae67e77e34d234e0f48e939f8` on AntelopeJS/antelopejs `next`.

## Bounds and what is left out

Three processes, two lock attempts each, one write step per holder, one disk refusal, one exit and one silence in all. A pass covers these bounds only.

The model leaves out:

- the heartbeat write itself: a holder is silent or not, and a silent holder stays silent until a waiter has decided, so no step starts between the lapse and the takeover. A silence between a read and the step that follows it, and the stall of a step that has begun, are not modeled; no file-system call makes them one step, and the docs say a command that has begun runs to its end;
- the clock: `Lapse` stands for 60 s of silence, or a folder with no owner that the file system dates past the creation window, and a lock owned by another host is never taken over;
- the three lock names, the wait for another process's download in `claim`, the lease of a run, and the manifest save: one lock, one guarded folder;
- a rename that fails for a reason other than a missing folder, and a release or a removal that fails;
- the 3 retries of `ensureDownloadLockHeld`, the 10 retries of `removeLockFolder`, and the 10 retries of `makeLockFolder` while Windows refuses with `EPERM` a folder another process still removes, which only repeat a step.
