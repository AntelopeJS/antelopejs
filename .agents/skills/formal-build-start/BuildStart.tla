---------------------------- MODULE BuildStart -----------------------------
(***************************************************************************)
(* `ajs project build` rewriting `.antelope/build/build.json` and pruning  *)
(* the module cache while `ajs project start` reads it and leases the     *)
(* module folders it names, as the code at the sync commit in SKILL.md     *)
(* runs it.                                                                *)
(*                                                                         *)
(* A build is named by its number; build 1 is in place at the start, and   *)
(* the module folder of build k is `f_k`. A builder downloads its folder,  *)
(* leases it, writes build.json, and prunes the folders no lease and no    *)
(* build.json names. A start reads build.json, leases the folders, waits   *)
(* for a prune that holds the lock, and reads build.json again until the   *)
(* read names what it leased. Each step is the code between two awaits.    *)
(***************************************************************************)
EXTENDS Naturals, FiniteSets

CONSTANTS
  Builders,        \* the builds that run, one build number each, all above 1
  Starts,          \* the starts that run
  AtomicWrite,     \* build.json is written to a temporary file and renamed over (#501)
  ReadAgain        \* start reads build.json again after it claims its folders (#497)

None == 0
Builds == {1} \cup Builders
Procs == Builders \cup Starts
Gone == 0

ASSUME Builders \cap Starts = {} /\ 1 \notin Builders

VARIABLES
  bj,       \* the build build.json names, or Gone while it is missing or half written
  dirs,     \* the module folders in the cache, by build number
  leases,   \* the folders each process's lease names
  plock,    \* the process that holds the prune lock, or None
  pc,       \* how far each process got
  snap,     \* what a prune read: manifest, leases, keep
  claimed,  \* the build a start has claimed
  fail      \* why a start failed: none, nobuild, missing

vars == <<bj, dirs, leases, plock, pc, snap, claimed, fail>>

Union(S) == UNION {leases[p] : p \in S}
AllLeases == Union(Procs)

TypeOK ==
  /\ bj \in Builds \cup {Gone}
  /\ dirs \subseteq Builds
  /\ leases \in [Procs -> SUBSET Builds]
  /\ plock \in Procs \cup {None}
  /\ claimed \in [Starts -> Builds \cup {None}]
  /\ fail \in [Starts -> {"none", "nobuild", "missing"}]

Init ==
  /\ bj = 1
  /\ dirs = {1}
  /\ leases = [p \in Procs |-> {}]
  /\ plock = None
  /\ pc = [p \in Procs |-> IF p \in Builders THEN "download" ELSE "read"]
  /\ snap = [p \in Builders |-> [manifest |-> {}, leased |-> {}, keep |-> None]]
  /\ claimed = [s \in Starts |-> None]
  /\ fail = [s \in Starts |-> "none"]

Go(p, next) == pc' = [pc EXCEPT ![p] = next]

\* writeBuildArtifact's caller: the build's module folder is in the cache and
\* leased by the building process, as every folder a run loads is.
Download(b) ==
  /\ pc[b] = "download"
  /\ dirs' = dirs \cup {b}
  /\ leases' = [leases EXCEPT ![b] = {b}]
  /\ Go(b, "write")
  /\ UNCHANGED <<bj, plock, snap, claimed, fail>>

\* build-artifact.ts:writeBuildArtifact: one rename of a temporary file, or,
\* before #501, the folder removed, created again, and build.json written.
Write(b) ==
  /\ pc[b] = "write"
  /\ IF AtomicWrite
       THEN /\ bj' = b /\ Go(b, "pruneLock")
       ELSE /\ bj' = Gone /\ Go(b, "rewrite")
  /\ UNCHANGED <<dirs, leases, plock, snap, claimed, fail>>

Rewrite(b) ==
  /\ pc[b] = "rewrite"
  /\ bj' = b /\ Go(b, "pruneLock")
  /\ UNCHANGED <<dirs, leases, plock, snap, claimed, fail>>

\* module-cache.ts:prune: tryAcquireCacheLock of the prune lock; a held lock skips the prune.
PruneLock(b) ==
  /\ pc[b] = "pruneLock"
  /\ IF plock = None
       THEN plock' = b /\ Go(b, "readManifest")
       ELSE plock' = plock /\ Go(b, "exit")
  /\ UNCHANGED <<bj, dirs, leases, snap, claimed, fail>>

\* moveUnusedToTrash: the manifest, then the leases, then the keep rule.
ReadManifest(b) ==
  /\ pc[b] = "readManifest"
  /\ snap' = [snap EXCEPT ![b].manifest = dirs]
  /\ Go(b, "readLeases")
  /\ UNCHANGED <<bj, dirs, leases, plock, claimed, fail>>

ReadLeases(b) ==
  /\ pc[b] = "readLeases"
  /\ snap' = [snap EXCEPT ![b].leased = AllLeases]
  /\ Go(b, "readKeep")
  /\ UNCHANGED <<bj, dirs, leases, plock, claimed, fail>>

\* cache-pruning.ts:readBuildKeep: a build.json that cannot be read aborts the prune.
ReadKeep(b) ==
  /\ pc[b] = "readKeep"
  /\ IF bj = Gone
       THEN Go(b, "unlock") /\ UNCHANGED snap
       ELSE snap' = [snap EXCEPT ![b].keep = bj] /\ Go(b, "trash")
  /\ UNCHANGED <<bj, dirs, leases, plock, claimed, fail>>

\* trashEntries: the unused folders leave the cache.
Trash(b) ==
  /\ pc[b] = "trash"
  /\ dirs' = dirs \ (snap[b].manifest \ (snap[b].leased \cup {snap[b].keep}))
  /\ Go(b, "unlock")
  /\ UNCHANGED <<bj, leases, plock, snap, claimed, fail>>

Unlock(b) ==
  /\ pc[b] = "unlock"
  /\ plock' = None
  /\ Go(b, "exit")
  /\ UNCHANGED <<bj, dirs, leases, snap, claimed, fail>>

\* The building process ends, and its lease with it.
Exit(b) ==
  /\ pc[b] = "exit"
  /\ leases' = [leases EXCEPT ![b] = {}]
  /\ Go(b, "done")
  /\ UNCHANGED <<bj, dirs, plock, snap, claimed, fail>>

\* launch-sequence.ts:readRefreshedBuild: build.json is read; a missing one is "no build".
Read(s) ==
  /\ pc[s] = "read"
  /\ IF bj = Gone
       THEN /\ Go(s, "failed") /\ fail' = [fail EXCEPT ![s] = "nobuild"] /\ UNCHANGED claimed
       ELSE /\ claimed' = [claimed EXCEPT ![s] = bj] /\ Go(s, "claim") /\ UNCHANGED fail
  /\ UNCHANGED <<bj, dirs, leases, plock, snap>>

\* module-cache.ts:claimFolder: the lease names the folder.
Claim(s) ==
  /\ pc[s] = "claim"
  /\ leases' = [leases EXCEPT ![s] = @ \cup {claimed[s]}]
  /\ Go(s, "wait")
  /\ UNCHANGED <<bj, dirs, plock, snap, claimed, fail>>

\* module-cache.ts:claim: waitWhileCacheLocked of the prune lock.
Wait(s) ==
  /\ pc[s] = "wait"
  /\ plock = None
  /\ Go(s, IF ReadAgain THEN "readAgain" ELSE "run")
  /\ UNCHANGED <<bj, dirs, leases, plock, snap, claimed, fail>>

\* launch-sequence.ts:claimCurrentBuild, readNewerBuild: a build that names other
\* folders is claimed in turn; a build.json that cannot be read keeps the claim.
Reread(s) ==
  /\ pc[s] = "readAgain"
  /\ IF bj # Gone /\ bj # claimed[s]
       THEN /\ claimed' = [claimed EXCEPT ![s] = bj] /\ Go(s, "claim")
       ELSE /\ Go(s, "run") /\ UNCHANGED claimed
  /\ UNCHANGED <<bj, dirs, leases, plock, snap, fail>>

\* The modules load from the folders claimed: a folder that is gone fails the start.
Run(s) ==
  /\ pc[s] = "run"
  /\ IF claimed[s] \in dirs
       THEN Go(s, "running") /\ UNCHANGED fail
       ELSE Go(s, "failed") /\ fail' = [fail EXCEPT ![s] = "missing"]
  /\ UNCHANGED <<bj, dirs, leases, plock, snap, claimed>>

Next ==
  \/ \E b \in Builders :
       Download(b) \/ Write(b) \/ Rewrite(b) \/ PruneLock(b) \/ ReadManifest(b)
       \/ ReadLeases(b) \/ ReadKeep(b) \/ Trash(b) \/ Unlock(b) \/ Exit(b)
  \/ \E s \in Starts : Read(s) \/ Claim(s) \/ Wait(s) \/ Reread(s) \/ Run(s)

Spec == Init /\ [][Next]_vars

(* A start that runs a build has every folder of it in the cache, leased by its own lease. *)
StartRunsValidBuild ==
  \A s \in Starts :
    pc[s] = "running" => (claimed[s] \in dirs /\ claimed[s] \in leases[s])

(* A start fails only when no valid build exists. Build 1 is in place from the start. *)
StartNeverFailsOnAValidBuild == \A s \in Starts : pc[s] # "failed"

=============================================================================
