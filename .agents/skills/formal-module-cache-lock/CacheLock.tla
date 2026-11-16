-------------------------- MODULE CacheLock --------------------------------
(***************************************************************************)
(* The cache lock protocol of src/core/modules/cache-lock.ts and its users *)
(* in module-cache.ts, as the code at the sync commit in SKILL.md runs it. *)
(*                                                                         *)
(* One lock is one folder `<cache>/<lock>` with an `owner.json` in it. A   *)
(* process takes it with `tryAcquireCacheLock`: it stages its owner beside *)
(* the folder, creates the folder, and renames the owner in. A holder      *)
(* runs steps that write the guarded cache folder, and checks that         *)
(* `owner.json` still holds its token before each one. A waiter takes over *)
(* a lock whose owner exited, whose owner is silent, or that has no owner  *)
(* past the creation window. Each step below is the code between two       *)
(* awaits, so another process interleaves between a read and what follows. *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Procs,               \* the processes that race on the lock
  MaxAttempts,         \* lock attempts of one process, a retry after a wait included
  Steps,               \* write steps one holder runs
  Fails,               \* owner writes the disk refuses, in all
  Crashes,             \* process exits, in all
  Stalls,              \* silences of a live holder or creator, in all
  StallCreators,       \* a creator may go silent between its mkdir and its owner
  GuardSteps,          \* a holder checks its token before each step (#499, #503)
  ConditionalCleanup,  \* a failed owner write removes the folder only if it is its own (#500)
  StageFirst,          \* the owner is written beside the folder before the folder exists (#504)
  AtomicRemoval        \* a takeover or a cleanup reads the owner and removes the folder as one step

None == 0
NoTok == <<0, 0>>
Tokens == {<<p, n>> : p \in Procs, n \in 1..MaxAttempts}
Settled == {"done", "failed", "dead"}
Kinds == {"cleanOwner", "cleanFolder", "cleanMiss", "takeover", "release"}

VARIABLES
  lock,       \* the lock folder: dir exists, owner token in owner.json, creator, lapsed
  pc,         \* how far each process got
  att,        \* lock attempts of each process
  seen,       \* the owner each process last read
  stalled,    \* a live process goes silent: no heartbeat, no step
  crashed,    \* the process exited, as a pid that no longer lives
  writing,    \* the process runs a step that writes the guarded folder
  stepsLeft,  \* write steps each holder still runs
  why,        \* what failed the owner write of each process: none, full, missing
  budget,     \* fails, crashes and stalls still to come
  foreign     \* the kinds of removal of a live process's lock folder so far

vars == <<lock, pc, att, seen, stalled, crashed, writing, stepsLeft, why,
          budget, foreign>>

Me(p) == <<p, att[p]>>
Live(p) == ~crashed[p] /\ ~stalled[p]

TypeOK ==
  /\ lock.dir \in BOOLEAN
  /\ lock.owner \in Tokens \cup {NoTok}
  /\ lock.maker \in Procs \cup {None}
  /\ lock.lapsed \in BOOLEAN
  /\ pc \in [Procs -> {"start", "stage", "mkdir", "rename", "read", "wait",
                       "takeCheck", "takeRm", "abandonRm", "held", "writing",
                       "cleanRead", "cleanRm", "releaseRead", "releaseRm",
                       "done", "failed", "dead"}]
  /\ att \in [Procs -> 0..MaxAttempts]
  /\ seen \in [Procs -> Tokens \cup {NoTok}]
  /\ stalled \in [Procs -> BOOLEAN]
  /\ crashed \in [Procs -> BOOLEAN]
  /\ writing \in [Procs -> BOOLEAN]
  /\ why \in [Procs -> {"none", "full", "missing"}]
  /\ foreign \subseteq Kinds

Init ==
  /\ lock = [dir |-> FALSE, owner |-> NoTok, maker |-> None, lapsed |-> FALSE]
  /\ pc = [p \in Procs |-> "start"]
  /\ att = [p \in Procs |-> 0]
  /\ seen = [p \in Procs |-> NoTok]
  /\ stalled = [p \in Procs |-> FALSE]
  /\ crashed = [p \in Procs |-> FALSE]
  /\ writing = [p \in Procs |-> FALSE]
  /\ stepsLeft = [p \in Procs |-> Steps]
  /\ why = [p \in Procs |-> "none"]
  /\ budget = [fails |-> Fails, crashes |-> Crashes, stalls |-> Stalls]
  /\ foreign = {}

(* Who the present folder belongs to: its owner, else the process that made it. *)
Holder == IF lock.owner # NoTok THEN lock.owner[1] ELSE lock.maker

(* A removal by p of a folder that another live, non-silent process holds, before it lapsed. *)
RemovesLive(p) ==
  /\ lock.dir
  /\ ~lock.lapsed
  /\ Holder # None
  /\ Holder # p
  /\ Live(Holder)

(* removeLockFolder: the folder and its owner are gone. *)
Remove(p, kind) ==
  /\ foreign' = IF RemovesLive(p) THEN foreign \cup {kind} ELSE foreign
  /\ lock' = [dir |-> FALSE, owner |-> NoTok, maker |-> None, lapsed |-> FALSE]

Go(p, next) == pc' = [pc EXCEPT ![p] = next]

\* cache-lock.ts:tryAcquireCacheLock, acquireCacheLock: a new attempt, a new token.
Start(p) ==
  /\ pc[p] = "start" /\ Live(p)
  /\ IF att[p] = MaxAttempts
       THEN /\ Go(p, "failed") /\ UNCHANGED att
       ELSE /\ att' = [att EXCEPT ![p] = @ + 1]
            /\ Go(p, IF StageFirst THEN "stage" ELSE "mkdir")
  /\ UNCHANGED <<lock, seen, stalled, crashed, writing, stepsLeft, why, budget, foreign>>

\* cache-lock.ts:createLockFolder: writeFile of the staged owner. A refused
\* write while the folder exists counts as a lock another process holds.
Stage(p) ==
  /\ pc[p] = "stage" /\ Live(p)
  /\ \/ /\ Go(p, "mkdir") /\ UNCHANGED budget
     \/ /\ budget.fails > 0
        /\ budget' = [budget EXCEPT !.fails = @ - 1]
        /\ Go(p, IF lock.dir THEN "read" ELSE "failed")
  /\ UNCHANGED <<lock, att, seen, stalled, crashed, writing, stepsLeft, why, foreign>>

\* cache-lock.ts:createLockFolder: mkdir of the folder; EEXIST is another's lock.
Mkdir(p) ==
  /\ pc[p] = "mkdir" /\ Live(p)
  /\ IF lock.dir
       THEN /\ Go(p, "read") /\ UNCHANGED lock
       ELSE /\ Go(p, "rename")
            /\ lock' = [dir |-> TRUE, owner |-> NoTok, maker |-> p, lapsed |-> FALSE]
  /\ UNCHANGED <<att, seen, stalled, crashed, writing, stepsLeft, why, budget, foreign>>

\* cache-lock.ts:createLockFolder: rename of the staged owner into the folder
\* (with StageFirst), or the direct write of `owner.json` (without it). Either
\* lands in whatever folder exists now, which may be another process's. A
\* missing folder fails it, and so does a disk that refuses the direct write.
Rename(p) ==
  /\ pc[p] = "rename" /\ Live(p)
  /\ \/ /\ lock.dir
        /\ lock' = [lock EXCEPT !.owner = Me(p)]
        /\ Go(p, "held")
        /\ UNCHANGED <<why, budget>>
     \/ /\ ~lock.dir
        /\ Go(p, "cleanRead")
        /\ why' = [why EXCEPT ![p] = "missing"]
        /\ UNCHANGED <<lock, budget>>
     \/ /\ ~StageFirst /\ budget.fails > 0
        /\ budget' = [budget EXCEPT !.fails = @ - 1]
        /\ Go(p, "cleanRead")
        /\ why' = [why EXCEPT ![p] = "full"]
        /\ UNCHANGED lock
  /\ UNCHANGED <<att, seen, stalled, crashed, writing, stepsLeft, foreign>>

\* cache-lock.ts:removeUnlessOwnedByAnother: read `owner.json` of the folder,
\* then remove the folder.
CleanKind(p) ==
  IF lock.owner # NoTok THEN "cleanOwner"
  ELSE IF why[p] = "full" THEN "cleanFolder" ELSE "cleanMiss"

KeepsForeign(p) ==
  ConditionalCleanup /\ lock.dir /\ lock.owner # NoTok /\ lock.owner # Me(p)

CleanRead(p) ==
  /\ pc[p] = "cleanRead" /\ Live(p)
  /\ IF KeepsForeign(p)
       THEN Go(p, "failed") /\ UNCHANGED <<lock, foreign>>
       ELSE IF AtomicRemoval
              THEN Remove(p, CleanKind(p)) /\ Go(p, "failed")
              ELSE Go(p, "cleanRm") /\ UNCHANGED <<lock, foreign>>
  /\ UNCHANGED <<att, seen, stalled, crashed, writing, stepsLeft, why, budget>>

CleanRm(p) ==
  /\ pc[p] = "cleanRm" /\ Live(p)
  /\ Remove(p, CleanKind(p))
  /\ Go(p, "failed")
  /\ UNCHANGED <<att, seen, stalled, crashed, writing, stepsLeft, why, budget>>

\* cache-lock.ts:tryAcquireCacheLock: the owner read after the folder exists.
Read(p) ==
  /\ pc[p] = "read" /\ Live(p)
  /\ seen' = [seen EXCEPT ![p] = lock.owner]
  /\ Go(p, IF lock.owner # NoTok /\ crashed[lock.owner[1]] THEN "takeCheck" ELSE "wait")
  /\ UNCHANGED <<lock, att, stalled, crashed, writing, stepsLeft, why, budget, foreign>>

\* cache-lock.ts:waitWhileCacheLocked: leaves when the folder is gone or its
\* owner exited, takes over an owner silent past the window, and removes a
\* folder with no owner past the creation window.
Wait(p) ==
  /\ pc[p] = "wait" /\ Live(p)
  /\ \/ /\ (~lock.dir \/ (lock.owner # NoTok /\ crashed[lock.owner[1]]))
        /\ Go(p, "start") /\ UNCHANGED <<seen, lock, foreign>>
     \/ /\ lock.dir /\ lock.owner # NoTok /\ lock.lapsed
        /\ seen' = [seen EXCEPT ![p] = lock.owner]
        /\ Go(p, "takeCheck") /\ UNCHANGED <<lock, foreign>>
     \/ /\ lock.dir /\ lock.owner = NoTok /\ lock.lapsed
        /\ IF AtomicRemoval
             THEN /\ Remove(p, "takeover") /\ Go(p, "start") /\ UNCHANGED seen
             ELSE /\ Go(p, "abandonRm") /\ UNCHANGED <<seen, lock, foreign>>
  /\ UNCHANGED <<att, stalled, crashed, writing, stepsLeft, why, budget>>

\* cache-lock.ts:removeIfHeldBy: read the owner, then remove the folder.
TakeCheck(p) ==
  /\ pc[p] = "takeCheck" /\ Live(p)
  /\ IF lock.dir /\ lock.owner = seen[p]
       THEN IF AtomicRemoval
              THEN Remove(p, "takeover") /\ Go(p, "start")
              ELSE Go(p, "takeRm") /\ UNCHANGED <<lock, foreign>>
       ELSE Go(p, "start") /\ UNCHANGED <<lock, foreign>>
  /\ UNCHANGED <<att, seen, stalled, crashed, writing, stepsLeft, why, budget>>

TakeRm(p) ==
  /\ pc[p] = "takeRm" /\ Live(p)
  /\ Remove(p, "takeover") /\ Go(p, "start")
  /\ UNCHANGED <<att, seen, stalled, crashed, writing, stepsLeft, why, budget>>

\* cache-lock.ts:waitWhileCacheLocked: removeLockFolder after isAbandoned.
AbandonRm(p) ==
  /\ pc[p] = "abandonRm" /\ Live(p)
  /\ Remove(p, "takeover") /\ Go(p, "start")
  /\ UNCHANGED <<att, seen, stalled, crashed, writing, stepsLeft, why, budget>>

\* module-cache.ts:ensureDownloadLockHeld before getFolder, commitVersion, and
\* each git and install step: the check and the start of the step are one atom.
BeginStep(p) ==
  /\ pc[p] = "held" /\ Live(p) /\ stepsLeft[p] > 0
  /\ IF GuardSteps /\ ~(lock.dir /\ lock.owner = Me(p))
       THEN Go(p, "releaseRead") /\ UNCHANGED <<writing, stepsLeft>>
       ELSE /\ Go(p, "writing")
            /\ writing' = [writing EXCEPT ![p] = TRUE]
            /\ stepsLeft' = [stepsLeft EXCEPT ![p] = @ - 1]
  /\ UNCHANGED <<lock, att, seen, stalled, crashed, why, budget, foreign>>

EndStep(p) ==
  /\ pc[p] = "writing" /\ ~crashed[p]
  /\ Go(p, "held")
  /\ writing' = [writing EXCEPT ![p] = FALSE]
  /\ UNCHANGED <<lock, att, seen, stalled, crashed, stepsLeft, why, budget, foreign>>

Finish(p) ==
  /\ pc[p] = "held" /\ Live(p)
  /\ Go(p, "releaseRead")
  /\ UNCHANGED <<lock, att, seen, stalled, crashed, writing, stepsLeft, why, budget, foreign>>

\* cache-lock.ts:release, removeIfHeldBy: read the owner, then remove the folder.
ReleaseRead(p) ==
  /\ pc[p] = "releaseRead" /\ Live(p)
  /\ Go(p, IF lock.dir /\ lock.owner = Me(p) THEN "releaseRm" ELSE "done")
  /\ UNCHANGED <<lock, att, seen, stalled, crashed, writing, stepsLeft, why, budget, foreign>>

ReleaseRm(p) ==
  /\ pc[p] = "releaseRm" /\ Live(p)
  /\ Remove(p, "release") /\ Go(p, "done")
  /\ UNCHANGED <<att, seen, stalled, crashed, writing, stepsLeft, why, budget>>

\* A holder, or a creator when StallCreators, goes silent: no heartbeat, no
\* step. A step that runs keeps its heartbeat, so a holder is silent only
\* between steps.
Stall(p) ==
  /\ pc[p] \in IF StallCreators THEN {"rename", "held"} ELSE {"held"}
  /\ Live(p) /\ budget.stalls > 0
  /\ stalled' = [stalled EXCEPT ![p] = TRUE]
  /\ budget' = [budget EXCEPT !.stalls = @ - 1]
  /\ UNCHANGED <<lock, pc, att, seen, crashed, writing, stepsLeft, why, foreign>>

\* A silent process resumes, unless a waiter is about to take its lapsed lock.
Resume(p) ==
  /\ stalled[p] /\ ~crashed[p]
  /\ ~(lock.dir /\ lock.lapsed /\ Holder = p)
  /\ stalled' = [stalled EXCEPT ![p] = FALSE]
  /\ UNCHANGED <<lock, pc, att, seen, crashed, writing, stepsLeft, why, budget, foreign>>

\* A process exits at any step. Its folder and owner stay behind.
Crash(p) ==
  /\ pc[p] \notin Settled /\ ~crashed[p] /\ budget.crashes > 0
  /\ crashed' = [crashed EXCEPT ![p] = TRUE]
  /\ writing' = [writing EXCEPT ![p] = FALSE]
  /\ budget' = [budget EXCEPT !.crashes = @ - 1]
  /\ Go(p, "dead")
  /\ UNCHANGED <<lock, att, seen, stalled, stepsLeft, why, foreign>>

\* A waiter's 60 s of silence: the holder of the lock stayed silent past the
\* window, or the creator of a folder with no owner stayed silent or exited. A
\* lapsed holder stays silent until a waiter has decided, so no step starts
\* after the lock lapsed and before it is taken over.
Lapse ==
  /\ lock.dir /\ ~lock.lapsed
  /\ IF lock.owner = NoTok
       THEN lock.maker # None /\ ~Live(lock.maker)
       ELSE stalled[lock.owner[1]]
  /\ lock' = [lock EXCEPT !.lapsed = TRUE]
  /\ UNCHANGED <<pc, att, seen, stalled, crashed, writing, stepsLeft, why, budget, foreign>>

Next ==
  \/ Lapse
  \/ \E p \in Procs :
       \/ Start(p) \/ Stage(p) \/ Mkdir(p) \/ Rename(p) \/ CleanRead(p)
       \/ CleanRm(p) \/ Read(p) \/ Wait(p) \/ TakeCheck(p) \/ TakeRm(p)
       \/ AbandonRm(p) \/ BeginStep(p) \/ EndStep(p) \/ Finish(p)
       \/ ReleaseRead(p) \/ ReleaseRm(p) \/ Stall(p) \/ Resume(p) \/ Crash(p)

Spec == Init /\ [][Next]_vars

(* At most one live process writes the guarded folder at a time. *)
SingleWriter == Cardinality({p \in Procs : writing[p]}) <= 1

(* A failed owner write never removes a folder whose owner is a live process. *)
NoCleanupOfLiveOwner == "cleanOwner" \notin foreign

(* A refused owner write never removes the folder a live process is creating. *)
NoCleanupOfLiveFolder == "cleanFolder" \notin foreign

(* A failed owner rename never removes the folder a live process holds or is creating. *)
NoCleanupAfterMiss == "cleanMiss" \notin foreign

(* A takeover removes only a folder whose holder lapsed or exited. *)
NoLiveTakeover == "takeover" \notin foreign

(* A release removes only a folder that still holds its own token. *)
NoForeignRelease == "release" \notin foreign

=============================================================================
