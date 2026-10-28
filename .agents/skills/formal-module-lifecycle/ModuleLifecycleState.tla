----------------------- MODULE ModuleLifecycleState ------------------------
(***************************************************************************)
(* The module-manager lifecycle of `ajs project dev --watch`, as the code *)
(* at the sync commit in SKILL.md runs it.                                *)
(*                                                                         *)
(* One launch is one `startProject` (src/core/repl/project-launch.ts): its *)
(* ShutdownManager, ModuleManager, FileWatcher and HotReload. A config     *)
(* edit that the watcher sees runs `restartProject`, which shuts the       *)
(* launch down and starts the next one. That is how `ajs project modules   *)
(* add/remove` reaches a running dev: both write antelope.config.ts.       *)
(*                                                                         *)
(* A generation is one `Module` instance (src/core/modules/module.ts);     *)
(* `state` is its `ModuleLifecycle._state`. Each lifecycle transition is   *)
(* one step: `ModuleLifecycle.enqueue` serializes the transitions of one   *)
(* generation. Every other step is the code between two awaits.            *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets, Sequences

CONSTANTS MaxEdits, MaxChanges

ModuleOrder == <<"a", "b">>
Modules == {ModuleOrder[i] : i \in DOMAIN ModuleOrder}
InitialModules == {"a"}
None == 0
MaxLaunch == MaxEdits + 1
Launches == 1..MaxLaunch
MaxGen == Len(ModuleOrder) * MaxLaunch + MaxChanges
Gens == 1..MaxGen
Index(m) == CHOOSE i \in DOMAIN ModuleOrder : ModuleOrder[i] = m
IdleReload == [pc |-> "idle", mod |-> "a", prev |-> None, repl |-> None,
               wasActive |-> FALSE]

VARIABLES
  declared,      \* the modules antelope.config.ts declares
  edits,         \* config edits so far (bound)
  jitiCache,     \* the config jiti first imported in this process, or {"none"}
  staleRead,     \* a launch read a config that differs from the file
  changes,       \* module source edits so far (bound)
  state,         \* ModuleLifecycle._state of each generation
  gmod,          \* the module id of each generation
  nextGen,       \* the next generation to create
  startPending,  \* generations whose `start` is queued in ModuleLifecycle
  launch,        \* the latest launch
  lpc,           \* how far each launch got
  cfgSeen,       \* the modules prepareFromConfig read for each launch
  awaiting,      \* generations a launch's constructAll / startAll waits on
  loaded,        \* ModuleManager.loaded of each launch: module -> generation
  lateStart,     \* a launch started its modules after its shutdown began
  sd,            \* how far each launch's ShutdownManager.executeHandlers got
  sdLeft,        \* modules stopAll / destroyAll still has to visit
  exitReq,       \* a requestedExitCode is set: process.exit after handlers
  armed,         \* the launch whose ShutdownManager is active (signals, crashes)
  watching,      \* FileWatcher of each launch: none, setup, yes, stopped
  watched,       \* modules the FileWatcher scanned
  cfgHash,       \* the config content the FileWatcher hashed last
  cfgEvent,      \* fs.watch reported a change of antelope.config.ts
  restartReq,    \* the config listener is reading the file (restartUnlessOwnWrite)
  isRestarting,  \* project-launch.ts `isRestarting`
  restartPc,     \* how far restartProject got
  restartFrom,   \* the launch restartProject is shutting down
  pending,       \* HotReload.pending
  rePending,     \* HotReload.rePending
  flushing,      \* HotReload.flushing
  batch,         \* the `modules` array HotReload.flush still iterates
  rl,            \* the reloadLoadedModuleFromSource in flight
  tolerance,     \* runtime-bootstrap.ts invalidatedWorkTolerance
  staleWork,     \* a destroyed generation left work that will fail with ModuleContextInvalidatedError
  sigint,        \* Ctrl+C reached the process
  exited,        \* the process exited
  crashed,       \* stale work shut the process down without Ctrl+C
  crashedWhileWatching \* ... while a watcher was up

vars == <<declared, edits, jitiCache, staleRead, changes, state, gmod, nextGen, startPending,
          launch, lpc, cfgSeen, awaiting, loaded, lateStart,
          sd, sdLeft, exitReq, armed,
          watching, watched, cfgHash, cfgEvent, restartReq,
          isRestarting, restartPc, restartFrom,
          pending, rePending, flushing, batch, rl,
          tolerance, staleWork, sigint, exited, crashed, crashedWhileWatching>>

genVars == <<state, gmod, nextGen, startPending>>
launchVars == <<launch, lpc, cfgSeen, awaiting, loaded, lateStart>>
sdVars == <<sd, sdLeft, exitReq, armed>>
watchVars == <<watching, watched, cfgHash, cfgEvent, restartReq>>
restartVars == <<isRestarting, restartPc, restartFrom>>
hrVars == <<pending, rePending, flushing, batch, rl>>
procVars == <<tolerance, staleWork, sigint, exited, crashed, crashedWhileWatching>>
editVars == <<declared, edits, jitiCache, staleRead, changes>>

Held(L) == {m \in Modules : loaded[L][m] /= None}
HeldGens(L) == {loaded[L][m] : m \in Held(L)}

Init ==
  /\ declared = InitialModules
  /\ edits = 0
  /\ jitiCache = {"none"}
  /\ staleRead = FALSE
  /\ changes = 0
  /\ state = [g \in Gens |-> "Loaded"]
  /\ gmod = [g \in Gens |-> "a"]
  /\ nextGen = 1
  /\ startPending = {}
  /\ launch = 1
  /\ lpc = [L \in Launches |-> IF L = 1 THEN "prepare" ELSE "none"]
  /\ cfgSeen = [L \in Launches |-> {}]
  /\ awaiting = [L \in Launches |-> {}]
  /\ loaded = [L \in Launches |-> [m \in Modules |-> None]]
  /\ lateStart = FALSE
  /\ sd = [L \in Launches |-> "none"]
  /\ sdLeft = [L \in Launches |-> {}]
  /\ exitReq = [L \in Launches |-> FALSE]
  /\ armed = 1
  /\ watching = [L \in Launches |-> "none"]
  /\ watched = [L \in Launches |-> {}]
  /\ cfgHash = [L \in Launches |-> {}]
  /\ cfgEvent = [L \in Launches |-> FALSE]
  /\ restartReq = [L \in Launches |-> FALSE]
  /\ isRestarting = FALSE
  /\ restartPc = "idle"
  /\ restartFrom = None
  /\ pending = [L \in Launches |-> {}]
  /\ rePending = [L \in Launches |-> {}]
  /\ flushing = [L \in Launches |-> FALSE]
  /\ batch = [L \in Launches |-> {}]
  /\ rl = [L \in Launches |-> IdleReload]
  /\ tolerance = 0
  /\ staleWork = FALSE
  /\ sigint = FALSE
  /\ exited = FALSE
  /\ crashed = FALSE
  /\ crashedWhileWatching = FALSE

(* ShutdownManager.shutdown: the first call aborts `stopping` and runs     *)
(* executeHandlers, whose first handler (shutdownModules, priority 30)     *)
(* starts stopAll at once; a later call returns the same promise.          *)
BeginShutdown(L) ==
  IF sd[L] = "none"                                      \* shutdown-manager.ts:127
  THEN /\ sd' = [sd EXCEPT ![L] = "stopAll"]             \* shutdown-manager.ts:131-132
       /\ sdLeft' = [sdLeft EXCEPT ![L] = Held(L)]       \* module-manager-lifecycle.ts:117
  ELSE UNCHANGED <<sd, sdLeft>>

Stopping(L) == sd[L] /= "none"

=============================================================================
