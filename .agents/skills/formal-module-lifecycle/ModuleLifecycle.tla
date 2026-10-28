--------------------------- MODULE ModuleLifecycle ---------------------------
(***************************************************************************)
(* Hot reload, the next-state relation and the rules. The variables, the   *)
(* launch, config restarts and the shutdown are in ModuleLifecycleLaunch.  *)
(***************************************************************************)
EXTENDS ModuleLifecycleLaunch

(* ------------------------------ hot reload ------------------------------ *)

(* A module source file changed: FileWatcher.notifyModuleChange calls     *)
(* HotReload.queue on every watcher that runs and scanned the module.     *)
SourceEdit(m) ==
  /\ ~exited /\ changes < MaxChanges
  /\ changes' = changes + 1
  /\ UNCHANGED <<jitiCache, staleRead, configOwner>>
  /\ LET W == {L \in Launches : watching[L] = "yes" /\ m \in watched[L]} \* file-watcher.ts:353
         InFlight(L) == rl[L].pc /= "idle" /\ rl[L].mod = m
     IN /\ rePending' = [L \in Launches |->               \* hot-reload.ts:21-22
             IF L \in W /\ InFlight(L) THEN rePending[L] \cup {m} ELSE rePending[L]]
        /\ pending' = [L \in Launches |->                 \* hot-reload.ts:25
             IF L \in W /\ ~InFlight(L) THEN pending[L] \cup {m} ELSE pending[L]]
  /\ UNCHANGED <<declared, edits, genVars, launchVars, sdVars, watchVars, restartVars,
                 flushing, batch, rl, procVars>>

(* The debounce timer fires and HotReload.flush takes the pending set. *)
FlushStarts(L) ==
  /\ ~exited /\ ~flushing[L] /\ pending[L] /= {}          \* hot-reload.ts:39
  /\ flushing' = [flushing EXCEPT ![L] = TRUE]            \* hot-reload.ts:52
  /\ batch' = [batch EXCEPT ![L] = pending[L]]            \* hot-reload.ts:55
  /\ pending' = [pending EXCEPT ![L] = {}]                \* hot-reload.ts:56
  /\ UNCHANGED <<editVars, genVars, launchVars, sdVars, watchVars, restartVars,
                 rePending, rl, procVars>>

(* reloadOne -> reloadLoadedModuleFromSource looks the entry up. *)
ReloadBegins(L, m) ==
  /\ ~exited /\ flushing[L] /\ rl[L].pc = "idle" /\ m \in batch[L] \* hot-reload.ts:58
  /\ batch' = [batch EXCEPT ![L] = @ \ {m}]
  /\ rl' = IF loaded[L][m] = None                         \* module-reloading.ts:45-46
           THEN rl
           ELSE [rl EXCEPT ![L] = [pc |-> "manifest", mod |-> m, prev |-> loaded[L][m],
                                   repl |-> None, wasActive |-> FALSE]]
  /\ UNCHANGED <<editVars, genVars, launchVars, sdVars, watchVars, restartVars,
                 pending, rePending, flushing, procVars>>

(* The `for` loop is done: rePending joins pending, and the `while` loop  *)
(* takes it, or flush ends.                                               *)
BatchEnds(L) ==
  /\ ~exited /\ flushing[L] /\ batch[L] = {} /\ rl[L].pc = "idle"
  /\ LET p == pending[L] \cup rePending[L] IN             \* hot-reload.ts:60-64
       IF p /= {}                                         \* hot-reload.ts:54
       THEN /\ batch' = [batch EXCEPT ![L] = p]
            /\ pending' = [pending EXCEPT ![L] = {}]
            /\ rePending' = [rePending EXCEPT ![L] = {}]
            /\ UNCHANGED flushing
       ELSE /\ flushing' = [flushing EXCEPT ![L] = FALSE] \* hot-reload.ts:68
            /\ UNCHANGED <<batch, pending, rePending>>
  /\ UNCHANGED <<editVars, genVars, launchVars, sdVars, watchVars, restartVars, rl,
                 procVars>>

(* The manifest is back: placeModule, `new Module`, checkReplacement.     *)
(* A failed check ends the reload; HotReload.reloadOne logs the error.    *)
RlManifestLoaded(L) ==
  /\ ~exited /\ rl[L].pc = "manifest" /\ nextGen <= MaxGen
  /\ gmod' = [gmod EXCEPT ![nextGen] = rl[L].mod]         \* module-reloading.ts:51-60
  /\ nextGen' = nextGen + 1
  /\ \/ rl' = [rl EXCEPT ![L] = IdleReload]               \* module-reloading.ts:63, hot-reload.ts:76
     \/ rl' = [rl EXCEPT ![L].pc = "destroy", ![L].repl = nextGen,
                         ![L].wasActive = (state[rl[L].prev] = "Active")] \* module-reloading.ts:68
  /\ UNCHANGED <<editVars, state, startPending, launchVars, sdVars, watchVars,
                 restartVars, pending, rePending, flushing, batch, procVars>>

(* previous.destroy(): ModuleLifecycle.destroy on the previous generation. *)
(* Its destroy callback can throw: the stop ran, the state stays          *)
(* Constructed.                                                           *)
RlDestroyPrevious(L) ==
  /\ ~exited /\ rl[L].pc = "destroy"
  /\ rl[L].prev \notin startPending                       \* module-lifecycle.ts:179
  /\ IF state[rl[L].prev] = "Loaded"                      \* module.ts:145
     THEN /\ rl' = [rl EXCEPT ![L].pc = "install"]
          /\ UNCHANGED <<state, staleWork>>
     ELSE \/ /\ state' = [state EXCEPT ![rl[L].prev] = "Loaded"] \* module-lifecycle.ts:161
             /\ staleWork' = TRUE
             /\ rl' = [rl EXCEPT ![L].pc = "install"]
          \/ /\ state' = [state EXCEPT ![rl[L].prev] = "Constructed"] \* module-lifecycle.ts:123
             /\ rl' = [rl EXCEPT ![L].pc = "recover"]     \* module-reloading.ts:71
             /\ UNCHANGED staleWork
  /\ UNCHANGED <<editVars, gmod, nextGen, startPending, launchVars, sdVars, watchVars,
                 restartVars, pending, rePending, flushing, batch, tolerance, sigint,
                 exited, crashed, crashedWhileWatching>>

(* After the destroy: unrequireModuleFiles, then activateReplacement      *)
(* installs the replacement with replaceLoadedModule, or throws when the  *)
(* manager no longer holds the module.                                    *)
RlInstall(L) ==
  /\ ~exited /\ rl[L].pc = "install"
  /\ EvictConfig(IF loaded[L][rl[L].mod] = None THEN {} ELSE {rl[L].mod}) \* module-reloading.ts:83, module-manager-cache.ts:25-28
  /\ IF loaded[L][rl[L].mod] = None                       \* module-reloading.ts:113
     THEN /\ rl' = [rl EXCEPT ![L] = IdleReload]          \* hot-reload.ts:76
          /\ UNCHANGED loaded
     ELSE /\ loaded' = [loaded EXCEPT ![L][rl[L].mod] = rl[L].repl] \* module-reloading.ts:111
          /\ rl' = [rl EXCEPT ![L].pc = "construct"]      \* module-reloading.ts:118
  /\ UNCHANGED <<declared, edits, staleRead, configOwner, changes, genVars, launch, lpc, cfgSeen, awaiting, lateStart, sdVars,
                 watchVars, restartVars, pending, rePending, flushing, batch, procVars>>

(* ModuleLifecycle.construct on the replacement. Its construct callback   *)
(* can throw after the state became Constructed.                          *)
RlConstruct(L) ==
  /\ ~exited /\ rl[L].pc = "construct"
  /\ IF state[rl[L].repl] = "Loaded"                      \* module.ts:97, module-lifecycle.ts:63
     THEN /\ state' = [state EXCEPT ![rl[L].repl] = "Constructed"] \* module-lifecycle.ts:76
          /\ \/ /\ rl' = [rl EXCEPT ![L].pc = "callStart"]
                /\ UNCHANGED staleWork
             \/ /\ rl' = [rl EXCEPT ![L].pc = "cleanup"]  \* module-reloading.ts:120
                /\ staleWork' = TRUE
     ELSE /\ rl' = [rl EXCEPT ![L].pc = "callStart"]
          /\ UNCHANGED <<state, staleWork>>
  /\ UNCHANGED <<editVars, gmod, nextGen, startPending, launchVars, sdVars, watchVars,
                 restartVars, pending, rePending, flushing, batch, tolerance, sigint,
                 exited, crashed, crashedWhileWatching>>

(* constructModules resolved: startModules queues the replacement's start. *)
RlCallStart(L) ==
  /\ ~exited /\ rl[L].pc = "callStart"
  /\ startPending' = startPending \cup {rl[L].repl}       \* module-reloading.ts:119
  /\ rl' = [rl EXCEPT ![L].pc = "starting"]
  /\ UNCHANGED <<editVars, state, gmod, nextGen, launchVars, sdVars, watchVars,
                 restartVars, pending, rePending, flushing, batch, procVars>>

RlStarted(L) ==
  /\ ~exited /\ rl[L].pc = "starting" /\ rl[L].repl \notin startPending
  /\ rl' = [rl EXCEPT ![L] = IdleReload]
  /\ UNCHANGED <<editVars, genVars, launchVars, sdVars, watchVars, restartVars,
                 pending, rePending, flushing, batch, procVars>>

(* cleanupReplacement destroys the replacement that failed to construct. *)
RlCleanup(L) ==
  /\ ~exited /\ rl[L].pc = "cleanup"
  /\ IF state[rl[L].repl] /= "Loaded"                     \* module-reloading.ts:122, :133
     THEN state' = [state EXCEPT ![rl[L].repl] = "Loaded"] \* module-lifecycle.ts:161
     ELSE UNCHANGED state
  /\ rl' = [rl EXCEPT ![L] = IdleReload]                  \* hot-reload.ts:76
  /\ UNCHANGED <<editVars, gmod, nextGen, startPending, launchVars, sdVars, watchVars,
                 restartVars, pending, rePending, flushing, batch, procVars>>

(* recoverPreviousModule restarts the previous generation that was       *)
(* active and failed to destroy.                                          *)
RlRecover(L) ==
  /\ ~exited /\ rl[L].pc = "recover"
  /\ IF rl[L].wasActive /\ state[rl[L].prev] = "Constructed" \* module-reloading.ts:92
     THEN /\ startPending' = startPending \cup {rl[L].prev} \* module-reloading.ts:96
          /\ rl' = [rl EXCEPT ![L].pc = "recovering"]
     ELSE /\ rl' = [rl EXCEPT ![L] = IdleReload]          \* hot-reload.ts:76
          /\ UNCHANGED startPending
  /\ UNCHANGED <<editVars, state, gmod, nextGen, launchVars, sdVars, watchVars,
                 restartVars, pending, rePending, flushing, batch, procVars>>

RlRecovered(L) ==
  /\ ~exited /\ rl[L].pc = "recovering" /\ rl[L].prev \notin startPending
  /\ rl' = [rl EXCEPT ![L] = IdleReload]                  \* hot-reload.ts:76
  /\ UNCHANGED <<editVars, genVars, launchVars, sdVars, watchVars, restartVars,
                 pending, rePending, flushing, batch, procVars>>

(* --------------------------------- spec --------------------------------- *)

LaunchStep(L) ==
  \/ LaunchPrepare(L) \/ LaunchAddModules(L) \/ LaunchConstruct(L)
  \/ \E g \in Gens : ConstructApply(L, g)
  \/ LaunchConstructed(L) \/ LaunchStart(L) \/ LaunchStarted(L)
  \/ LaunchWatch(L) \/ LaunchHashConfig(L) \/ LaunchWatching(L)

ShutdownStep(L) ==
  \/ \E m \in Modules : SdStop(L, m)
  \/ SdStopDone(L)
  \/ \E m \in Modules : SdDestroy(L, m)
  \/ SdClear(L) \/ SdWatcher(L) \/ SdRelease(L) \/ SdTolerance(L) \/ SdExit(L)

ReloadStep(L) ==
  \/ FlushStarts(L) \/ BatchEnds(L)
  \/ \E m \in Modules : ReloadBegins(L, m)
  \/ RlManifestLoaded(L) \/ RlDestroyPrevious(L) \/ RlInstall(L) \/ RlConstruct(L)
  \/ RlCallStart(L) \/ RlStarted(L) \/ RlCleanup(L) \/ RlRecover(L) \/ RlRecovered(L)

User ==
  \/ \E m \in Modules : ConfigEdit(m)
  \/ \E m \in Modules : SourceEdit(m)
  \/ Sigint

System ==
  \/ \E L \in Launches : LaunchStep(L) \/ ShutdownStep(L) \/ ReloadStep(L)
                         \/ ConfigNoticed(L) \/ RestartRequested(L)
  \/ \E g \in Gens : StartApply(g)
  \/ RestartLaunches
  \/ StaleWorkFails

Next == User \/ System

Spec == Init /\ [][Next]_vars

(* --------------------------------- rules -------------------------------- *)

States == {"Loaded", "Constructed", "Active"}
ReloadPcs == {"idle", "manifest", "destroy", "install", "construct", "callStart",
              "starting", "cleanup", "recover", "recovering"}

TypeOK ==
  /\ declared \subseteq Modules
  /\ jitiCache \subseteq Modules \/ jitiCache = {"none"}
  /\ configOwner \in {"none", "a"}
  /\ state \in [Gens -> States]
  /\ nextGen \in 1..(MaxGen + 1)
  /\ startPending \subseteq Gens
  /\ loaded \in [Launches -> [Modules -> 0..MaxGen]]
  /\ \A L \in Launches : rl[L].pc \in ReloadPcs
  /\ tolerance \in 0..MaxLaunch

Created == 1..(nextGen - 1)

\* Every module generation that is constructed or running is one the project
\* still holds in a ModuleManager: no generation runs on where no stop or
\* destroy can reach it.
NoOrphanGeneration ==
  ~exited => \A g \in Created :
    state[g] /= "Loaded" => \E L \in Launches : loaded[L][gmod[g]] = g

\* A reload never runs the old and the new generation of a module at once.
ReloadNeverOverlaps ==
  \A L \in Launches :
    rl[L].repl /= None =>
      ~(state[rl[L].prev] = "Active" /\ state[rl[L].repl] = "Active")

Quiet(L) ==
  /\ ~exited /\ lpc[L] = "running" /\ sd[L] = "none" /\ rl[L].pc = "idle"
  /\ HeldGens(L) \cap startPending = {}

\* When a running project has no reload in flight, no module of it sits
\* constructed but not started: a failed reload leaves its module running
\* or fully destroyed.
NoHalfBuiltModule ==
  \A L \in Launches : Quiet(L) =>
    \A m \in Held(L) : state[loaded[L][m]] /= "Constructed"

\* A launch never starts its modules once the project began stopping.
LaunchNeverStartsWhileStopping == ~lateStart

Settled ==
  /\ ~exited /\ lpc[launch] = "running" /\ sd[launch] = "none" /\ ~isRestarting
  /\ \A L \in Launches : ~cfgEvent[L] /\ ~restartReq[L]

\* Every launch, the ones a config edit restarts included, loads
\* antelope.config.ts as the file holds it when the launch reads it.
LaunchReadsCurrentConfig == ~staleRead

\* Once the project settles, it holds exactly the modules antelope.config.ts
\* declares: adding or removing a module while dev runs reaches the project.
ConfigEditsReachProject == Settled => Held(launch) = declared

\* While a watcher is up, a failed reload and the work its destroyed
\* generations leave behind never stop the dev process.
DevSurvivesFailedReload == ~crashedWhileWatching

\* Work a destroyed generation leaves behind never stops the dev process
\* unless the user stopped it.
NoCrashFromStaleWork == ~crashed

=============================================================================
