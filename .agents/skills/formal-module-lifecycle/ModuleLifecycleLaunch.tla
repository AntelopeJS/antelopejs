----------------------- MODULE ModuleLifecycleLaunch -----------------------
(***************************************************************************)
(* The launch, config edits and restarts, Ctrl+C and the shutdown.         *)
(***************************************************************************)
EXTENDS ModuleLifecycleState

(* ---------------------------- launch -------------------------------- *)

(* prepareFromConfig imports antelope.config.ts through ConfigLoader.load, *)
(* which asks jiti without `fresh`: jiti's module cache answers with the  *)
(* content this process imported first.                                   *)
LaunchPrepare(L) ==
  /\ ~exited /\ lpc[L] = "prepare"
  /\ LET read == IF jitiCache = {"none"} THEN declared ELSE jitiCache \* config-loader.ts:145, :42-49
     IN /\ cfgSeen' = [cfgSeen EXCEPT ![L] = read]       \* launch-sequence.ts:115
        /\ jitiCache' = read
        /\ staleRead' = (staleRead \/ read /= declared)
  /\ lpc' = [lpc EXCEPT ![L] = "addModules"]
  /\ UNCHANGED <<declared, edits, configOwner, changes, genVars, launch, awaiting, loaded, lateStart,
                 sdVars, watchVars, restartVars, hrVars, procVars>>

Interrupt(L) ==
  /\ lpc' = [lpc EXCEPT ![L] = "interrupted"]
  /\ UNCHANGED <<editVars, genVars, launch, cfgSeen, awaiting, loaded, lateStart,
                 sdVars, watchVars, restartVars, hrVars, procVars>>

(* runLaunchSteps, then the addModules step. *)
LaunchAddModules(L) ==
  /\ ~exited /\ lpc[L] = "addModules"
  /\ IF Stopping(L)                                       \* launch-steps.ts:35
     THEN Interrupt(L)
     ELSE LET S == cfgSeen[L]
              G(m) == nextGen + Cardinality({x \in S : Index(x) < Index(m)})
          IN /\ nextGen + Cardinality(S) <= MaxGen + 1
             /\ loaded' = [loaded EXCEPT ![L] =           \* launch-sequence.ts:323
                  [m \in Modules |-> IF m \in S THEN G(m) ELSE None]]
             /\ gmod' = [g \in Gens |->
                  IF \E m \in S : G(m) = g THEN CHOOSE m \in S : G(m) = g ELSE gmod[g]]
             /\ nextGen' = nextGen + Cardinality(S)
             /\ lpc' = [lpc EXCEPT ![L] = "construct"]
             /\ UNCHANGED <<editVars, state, startPending, launch, cfgSeen, awaiting,
                            lateStart, sdVars, watchVars, restartVars, hrVars, procVars>>

(* runLaunchSteps, then constructAll calls construct on every loaded module. *)
LaunchConstruct(L) ==
  /\ ~exited /\ lpc[L] = "construct"
  /\ IF Stopping(L)                                       \* launch-steps.ts:35
     THEN Interrupt(L)
     ELSE /\ awaiting' = [awaiting EXCEPT ![L] = HeldGens(L)] \* module-manager-construction.ts:181
          /\ lpc' = [lpc EXCEPT ![L] = "constructing"]
          /\ UNCHANGED <<editVars, genVars, launch, cfgSeen, loaded, lateStart, sdVars,
                         watchVars, restartVars, hrVars, procVars>>

(* Module.construct loads the code, then ModuleLifecycle.construct runs.  *)
(* A destroy that came first found the module Loaded and did nothing.     *)
ConstructApply(L, g) ==
  /\ ~exited /\ lpc[L] = "constructing" /\ g \in awaiting[L]
  /\ awaiting' = [awaiting EXCEPT ![L] = @ \ {g}]
  /\ state' = IF state[g] = "Loaded"                      \* module-lifecycle.ts:63
              THEN [state EXCEPT ![g] = "Constructed"]    \* module-lifecycle.ts:76
              ELSE state
  /\ UNCHANGED <<editVars, gmod, nextGen, startPending, launch, lpc, cfgSeen, loaded,
                 lateStart, sdVars, watchVars, restartVars, hrVars, procVars>>

LaunchConstructed(L) ==
  /\ ~exited /\ lpc[L] = "constructing" /\ awaiting[L] = {}
  /\ lpc' = [lpc EXCEPT ![L] = "start"]
  /\ UNCHANGED <<editVars, genVars, launch, cfgSeen, awaiting, loaded, lateStart,
                 sdVars, watchVars, restartVars, hrVars, procVars>>

(* runLaunchSteps, then startAll queues `start` on every loaded module. *)
LaunchStart(L) ==
  /\ ~exited /\ lpc[L] = "start"
  /\ IF Stopping(L)                                       \* launch-steps.ts:35
     THEN Interrupt(L)
     ELSE /\ startPending' = startPending \cup HeldGens(L) \* module-manager-lifecycle.ts:106
          /\ awaiting' = [awaiting EXCEPT ![L] = HeldGens(L)]
          /\ lateStart' = (lateStart \/ Stopping(L))
          /\ lpc' = [lpc EXCEPT ![L] = "starting"]
          /\ UNCHANGED <<editVars, state, gmod, nextGen, launch, cfgSeen, loaded,
                         sdVars, watchVars, restartVars, hrVars, procVars>>

(* ModuleLifecycle.start: Constructed -> Active. *)
StartApply(g) ==
  /\ ~exited /\ g \in startPending
  /\ startPending' = startPending \ {g}
  /\ state' = IF state[g] = "Constructed"                 \* module-lifecycle.ts:87
              THEN [state EXCEPT ![g] = "Active"]         \* module-lifecycle.ts:100
              ELSE state
  /\ UNCHANGED <<editVars, gmod, nextGen, launchVars, sdVars, watchVars,
                 restartVars, hrVars, procVars>>

LaunchStarted(L) ==
  /\ ~exited /\ lpc[L] = "starting" /\ awaiting[L] \cap startPending = {}
  /\ awaiting' = [awaiting EXCEPT ![L] = {}]
  /\ lpc' = [lpc EXCEPT ![L] = "watch"]
  /\ UNCHANGED <<editVars, genVars, launch, cfgSeen, loaded, lateStart, sdVars,
                 watchVars, restartVars, hrVars, procVars>>

(* startProject's post-launch step setupWatching: registers the watcher's *)
(* shutdown handler and the tolerance, then scans every loaded module.    *)
LaunchWatch(L) ==
  /\ ~exited /\ lpc[L] = "watch"
  /\ IF Stopping(L)                                       \* launch-steps.ts:35
     THEN Interrupt(L)
     ELSE /\ watching' = [watching EXCEPT ![L] = "setup"]  \* project-launch.ts:93-94
          /\ tolerance' = tolerance + 1                   \* runtime-bootstrap.ts:76
          /\ watched' = [watched EXCEPT ![L] = Held(L)]   \* project-launch.ts:101
          /\ lpc' = [lpc EXCEPT ![L] = "hashConfig"]
          /\ UNCHANGED <<editVars, genVars, launch, cfgSeen, awaiting, loaded, lateStart,
                         sdVars, cfgHash, cfgEvent, restartReq, restartVars, hrVars,
                         staleWork, sigint, exited, crashed, crashedWhileWatching>>

(* FileWatcher.watchFile hashes antelope.config.ts. *)
LaunchHashConfig(L) ==
  /\ ~exited /\ lpc[L] = "hashConfig"
  /\ cfgHash' = [cfgHash EXCEPT ![L] = declared]          \* project-launch.ts:108
  /\ lpc' = [lpc EXCEPT ![L] = "startWatching"]
  /\ UNCHANGED <<editVars, genVars, launch, cfgSeen, awaiting, loaded, lateStart,
                 sdVars, watching, watched, cfgEvent, restartReq, restartVars, hrVars,
                 procVars>>

(* FileWatcher.startWatching; startProject returns, and restartProject    *)
(* clears isRestarting.                                                   *)
LaunchWatching(L) ==
  /\ ~exited /\ lpc[L] = "startWatching"
  /\ watching' = [watching EXCEPT ![L] =
       IF watching[L] = "stopped" THEN "stopped" ELSE "yes"] \* file-watcher.ts:89, project-launch.ts:116
  /\ lpc' = [lpc EXCEPT ![L] = "running"]
  /\ IF restartPc = "start" /\ L = launch
     THEN /\ isRestarting' = FALSE                        \* project-launch.ts:217
          /\ restartPc' = "idle"
     ELSE UNCHANGED <<isRestarting, restartPc>>
  /\ UNCHANGED <<editVars, genVars, launch, cfgSeen, awaiting, loaded, lateStart,
                 sdVars, watched, cfgHash, cfgEvent, restartReq, restartFrom, hrVars,
                 procVars>>

(* ----------------------- config edits and restarts ---------------------- *)

(* `ajs project modules add/remove` (writeConfig) or the user edits       *)
(* antelope.config.ts; fs.watch reports it to every watcher that runs.    *)
ConfigEdit(m) ==
  /\ ~exited /\ edits < MaxEdits
  /\ declared' = IF m \in declared THEN declared \ {m} ELSE declared \cup {m}
  /\ edits' = edits + 1
  /\ UNCHANGED <<jitiCache, staleRead, configOwner>>
  /\ cfgEvent' = [L \in Launches |-> cfgEvent[L] \/ watching[L] = "yes"]
  /\ UNCHANGED <<changes, genVars, launchVars, sdVars, watching, watched, cfgHash,
                 restartReq, restartVars, hrVars, procVars>>

(* FileWatcher.handleWatchedFileChange: hash, compare, call the listener. *)
ConfigNoticed(L) ==
  /\ ~exited /\ cfgEvent[L]
  /\ cfgEvent' = [cfgEvent EXCEPT ![L] = FALSE]
  /\ IF watching[L] = "yes"                               \* file-watcher.ts:160, :219
        /\ declared /= cfgHash[L]                         \* file-watcher.ts:214
     THEN /\ cfgHash' = [cfgHash EXCEPT ![L] = declared]  \* file-watcher.ts:218
          /\ restartReq' = [restartReq EXCEPT ![L] = TRUE] \* file-watcher.ts:223
     ELSE UNCHANGED <<cfgHash, restartReq>>
  /\ UNCHANGED <<editVars, genVars, launchVars, sdVars, watching, watched,
                 restartVars, hrVars, procVars>>

(* restartUnlessOwnWrite read the file (not the runtime's own write), and *)
(* restartProject runs: it shuts the active launch down.                  *)
RestartRequested(L) ==
  /\ ~exited /\ restartReq[L]
  /\ restartReq' = [restartReq EXCEPT ![L] = FALSE]
  /\ IF isRestarting                                      \* project-launch.ts:206
     THEN UNCHANGED <<isRestarting, restartPc, restartFrom, sd, sdLeft>>
     ELSE /\ isRestarting' = TRUE                         \* project-launch.ts:207
          /\ restartPc' = "shutdown"
          /\ restartFrom' = armed
          /\ IF armed /= None THEN BeginShutdown(armed)   \* project-launch.ts:212
             ELSE UNCHANGED <<sd, sdLeft>>
  /\ UNCHANGED <<editVars, genVars, launchVars, exitReq, armed, watching, watched,
                 cfgHash, cfgEvent, hrVars, procVars>>

(* The shutdown resolved: startProject runs the next launch, and          *)
(* runLaunchSequence arms its ShutdownManager before its first await.     *)
RestartLaunches ==
  /\ ~exited /\ restartPc = "shutdown"
  /\ IF restartFrom = None THEN TRUE ELSE sd[restartFrom] = "done"
  /\ launch < MaxLaunch
  /\ launch' = launch + 1                                 \* project-launch.ts:215
  /\ lpc' = [lpc EXCEPT ![launch + 1] = "prepare"]
  /\ armed' = launch + 1                                  \* launch-sequence.ts:253, process-claim.ts:160
  /\ restartPc' = "start"
  /\ UNCHANGED <<editVars, genVars, cfgSeen, awaiting, loaded, lateStart, sd, sdLeft,
                 exitReq, watchVars, isRestarting, restartFrom, hrVars, procVars>>

(* ------------------------------ shutdown -------------------------------- *)

(* Ctrl+C. With no ShutdownManager listening, Node's default kills the    *)
(* process.                                                               *)
Sigint ==
  /\ ~exited /\ ~sigint
  /\ sigint' = TRUE
  /\ IF armed /= None                                     \* process-claim.ts:39
     THEN /\ exitReq' = [exitReq EXCEPT ![armed] = TRUE]  \* shutdown-manager.ts:191
          /\ BeginShutdown(armed)
          /\ UNCHANGED exited
     ELSE /\ exited' = TRUE
          /\ UNCHANGED <<exitReq, sd, sdLeft>>
  /\ UNCHANGED <<editVars, genVars, launchVars, armed, watchVars, restartVars, hrVars,
                 tolerance, staleWork, crashed, crashedWhileWatching>>

(* stopAll stops one module: entry.module as the loop reaches it.         *)
SdStop(L, m) ==
  /\ ~exited /\ sd[L] = "stopAll" /\ m \in sdLeft[L]
  /\ loaded[L][m] \notin startPending                     \* module-lifecycle.ts:179
  /\ sdLeft' = [sdLeft EXCEPT ![L] = @ \ {m}]
  /\ state' = IF loaded[L][m] /= None /\ state[loaded[L][m]] = "Active" \* module-lifecycle.ts:108
              THEN [state EXCEPT ![loaded[L][m]] = "Constructed"]     \* module-lifecycle.ts:123
              ELSE state
  /\ UNCHANGED <<editVars, gmod, nextGen, startPending, launchVars, sd, exitReq, armed,
                 watchVars, restartVars, hrVars, procVars>>

SdStopDone(L) ==
  /\ ~exited /\ sd[L] = "stopAll" /\ sdLeft[L] = {}
  /\ sd' = [sd EXCEPT ![L] = "destroyAll"]
  /\ sdLeft' = [sdLeft EXCEPT ![L] = Held(L)]             \* module-manager-lifecycle.ts:127
  /\ UNCHANGED <<editVars, genVars, launchVars, exitReq, armed, watchVars, restartVars,
                 hrVars, procVars>>

(* destroyAll destroys one module: entry.module as the loop reaches it.   *)
SdDestroy(L, m) ==
  /\ ~exited /\ sd[L] = "destroyAll" /\ m \in sdLeft[L]
  /\ loaded[L][m] \notin startPending                     \* module-lifecycle.ts:179
  /\ sdLeft' = [sdLeft EXCEPT ![L] = @ \ {m}]
  /\ IF loaded[L][m] /= None /\ state[loaded[L][m]] /= "Loaded" \* module.ts:145
     THEN /\ state' = [state EXCEPT ![loaded[L][m]] = "Loaded"] \* module-lifecycle.ts:161
          /\ staleWork' = TRUE
     ELSE UNCHANGED <<state, staleWork>>
  /\ UNCHANGED <<editVars, gmod, nextGen, startPending, launchVars, sd, exitReq, armed,
                 watchVars, restartVars, hrVars, tolerance, sigint, exited, crashed,
                 crashedWhileWatching>>

(* destroyAll evicts each loaded module's files from require.cache, which *)
(* drops jiti's cached config when it sits in a module folder, then       *)
(* clearManagedState empties ModuleManager.loaded.                        *)
SdClear(L) ==
  /\ ~exited /\ sd[L] = "destroyAll" /\ sdLeft[L] = {}
  /\ EvictConfig(Held(L))                                 \* module-manager-lifecycle.ts:135-136
  /\ loaded' = [loaded EXCEPT ![L] = [m \in Modules |-> None]] \* module-manager-lifecycle.ts:140, :168
  /\ sd' = [sd EXCEPT ![L] = "watcher"]
  /\ UNCHANGED <<declared, edits, staleRead, configOwner, changes, genVars, launch, lpc, cfgSeen, awaiting, lateStart, sdLeft,
                 exitReq, armed, watchVars, restartVars, hrVars, procVars>>

(* Priority 20: hotReload.clear() and watcher.stopWatching(). *)
SdWatcher(L) ==
  /\ ~exited /\ sd[L] = "watcher"
  /\ IF watching[L] /= "none"
     THEN /\ watching' = [watching EXCEPT ![L] = "stopped"] \* project-launch.ts:94
          /\ pending' = [pending EXCEPT ![L] = {}]        \* hot-reload.ts:34
          /\ rePending' = [rePending EXCEPT ![L] = {}]    \* hot-reload.ts:35
     ELSE UNCHANGED <<watching, pending, rePending>>
  /\ sd' = [sd EXCEPT ![L] = "release"]
  /\ UNCHANGED <<editVars, genVars, launchVars, sdLeft, exitReq, armed, watched, cfgHash,
                 cfgEvent, restartReq, restartVars, flushing, batch, rl, procVars>>

(* Priority 10, registered first by claimProcess: release the managers. *)
SdRelease(L) ==
  /\ ~exited /\ sd[L] = "release"
  /\ armed' = IF armed = L THEN None ELSE armed           \* process-claim.ts:156
  /\ sd' = [sd EXCEPT ![L] = "tolerance"]
  /\ UNCHANGED <<editVars, genVars, launchVars, sdLeft, exitReq, watchVars, restartVars,
                 hrVars, procVars>>

(* Priority 10, registered by setupWatching: withdraw the tolerance. *)
SdTolerance(L) ==
  /\ ~exited /\ sd[L] = "tolerance"
  /\ tolerance' = IF watching[L] /= "none" THEN tolerance - 1 ELSE tolerance \* project-launch.ts:55
  /\ sd' = [sd EXCEPT ![L] = "exiting"]
  /\ UNCHANGED <<editVars, genVars, launchVars, sdLeft, exitReq, armed, watchVars,
                 restartVars, hrVars, staleWork, sigint, exited, crashed,
                 crashedWhileWatching>>

(* executeShutdown: process.exit when an exit code was requested. *)
SdExit(L) ==
  /\ ~exited /\ sd[L] = "exiting"
  /\ sd' = [sd EXCEPT ![L] = "done"]
  /\ exited' = exitReq[L]                                 \* shutdown-manager.ts:234
  /\ UNCHANGED <<editVars, genVars, launchVars, sdLeft, exitReq, armed, watchVars,
                 restartVars, hrVars, tolerance, staleWork, sigint, crashed,
                 crashedWhileWatching>>

(* Work a destroyed generation left behind resumes and fails with         *)
(* ModuleContextInvalidatedError, unhandled.                              *)
StaleWorkFails ==
  /\ ~exited /\ staleWork
  /\ staleWork' = FALSE
  /\ IF tolerance > 0                                     \* runtime-bootstrap.ts:37
     THEN UNCHANGED <<crashed, crashedWhileWatching, exitReq, sd, sdLeft, exited>>
     ELSE /\ crashed' = (crashed \/ ~sigint)
          /\ crashedWhileWatching' = (crashedWhileWatching \/
               (~sigint /\ \E L \in Launches : watching[L] = "yes"))
          /\ IF armed /= None                             \* runtime-bootstrap.ts:24
             THEN /\ exitReq' = [exitReq EXCEPT ![armed] = TRUE] \* runtime-bootstrap.ts:111
                  /\ BeginShutdown(armed)
                  /\ UNCHANGED exited
             ELSE /\ exited' = TRUE                       \* runtime-bootstrap.ts:30
                  /\ UNCHANGED <<exitReq, sd, sdLeft>>
  /\ UNCHANGED <<editVars, genVars, launchVars, armed, watchVars, restartVars, hrVars,
                 tolerance, sigint>>

=============================================================================
