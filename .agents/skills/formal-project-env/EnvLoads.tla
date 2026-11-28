---- MODULE EnvLoads ----
\* Overlapping launches of one project load its .env into the process-global
\* process.env, and a launch interrupted while it prepares withdraws what it
\* loaded. One variable of one .env stands for them all.
EXTENDS Naturals, Sequences

CONSTANTS Launches, Mode

\* The withdrawal design: none before #588, unloadLast from #588 (before #594),
\* snapshot from #594 (before #596), owned from #596.
ASSUME Mode \in {"none", "unloadLast", "snapshot", "owned"}

VARIABLES
  st,      \* each launch: idle, preparing, live or withdrawn
  env,     \* the variable in process.env: unset or loaded
  loads,   \* the loads of the .env the code still records, oldest first
  held,    \* the launches whose recorded load still holds the variable
  snap,    \* what each launch recorded when it started (snapshot)
  history  \* every load and user deletion, in order

vars == <<st, env, loads, held, snap, history>>

Range(s) == {s[i] : i \in DOMAIN s}
Last(s) == s[Len(s)]
Without(s, L) == SelectSeq(s, LAMBDA x : x # L)
Loaded(L) == \E i \in DOMAIN history : history[i] = <<"load", L>>

\* project-env.ts:dropSupersededLoads, under the launch states `s`.
DropSuperseded(q, s) ==
  LET kept == {i \in DOMAIN q : s[q[i]] # "preparing"}
      from == IF kept = {} THEN 1 ELSE CHOOSE i \in kept : \A j \in kept : j <= i
  IN SubSeq(q, from, Len(q))

TypeOK ==
  /\ st \in [Launches -> {"idle", "preparing", "live", "withdrawn"}]
  /\ env \in {"unset", "loaded"}
  /\ Range(loads) \subseteq Launches
  /\ held \subseteq Launches

Init ==
  /\ st = [L \in Launches |-> "idle"]
  /\ env = "unset"
  /\ loads = <<>>
  /\ held = {}
  /\ snap = [L \in Launches |-> [loads |-> <<>>, held |-> {}]]
  /\ history = <<>>

\* launch-sequence.ts:prepareProject: new LaunchEnvLoads(), snapshotProjectEnv.
Start(L) ==
  /\ st[L] = "idle"
  /\ st' = [st EXCEPT ![L] = "preparing"]
  /\ snap' = [snap EXCEPT ![L] = [loads |-> loads, held |-> held]]
  /\ UNCHANGED <<env, loads, held, history>>

\* project-env.ts:loadProjectEnv, inside LaunchEnvLoads.record.
Load(L) ==
  /\ st[L] = "preparing"
  /\ ~Loaded(L)
  /\ LET prevHolds == loads # <<>> /\ Last(loads) \in held
         out == IF prevHolds /\ env = "loaded" THEN "unset" ELSE env
         kept == IF Mode # "owned" THEN {}
                 ELSE IF prevHolds /\ env = "unset" THEN held \ Range(loads)
                 ELSE held
     IN /\ env' = "loaded"
        /\ held' = IF out = "unset" THEN kept \cup {L} ELSE kept
        /\ loads' = IF Mode = "owned"
                      THEN DropSuperseded(Append(loads, L), st)
                      ELSE <<L>>
  /\ history' = Append(history, <<"load", L>>)
  /\ UNCHANGED <<st, snap>>

\* project-env.ts:LaunchEnvLoads.keep: the preparation settles unshut.
Complete(L) ==
  /\ st[L] = "preparing"
  /\ Loaded(L)
  /\ st' = [st EXCEPT ![L] = "live"]
  /\ loads' = IF Mode = "owned" THEN DropSuperseded(loads, st') ELSE loads
  /\ UNCHANGED <<env, held, snap, history>>

\* Something outside the launches deletes the variable.
UserDelete ==
  /\ env = "loaded"
  /\ env' = "unset"
  /\ history' = Append(history, <<"delete">>)
  /\ UNCHANGED <<st, loads, held, snap>>

\* project-env.ts:forgetPreviousLoad, the old modes' undo of the last load.
Forgotten == IF loads # <<>> /\ Last(loads) \in held /\ env = "loaded"
               THEN "unset" ELSE env

\* restoreProjectEnv: forget the last load, then set again what the snapshot
\* load held, where nothing holds it now.
Restore(L) ==
  LET s == snap[L]
      back == s.loads # <<>> /\ Last(s.loads) \in s.held /\ Forgotten = "unset"
  IN /\ env' = IF back THEN "loaded" ELSE Forgotten
     /\ loads' = s.loads
     /\ held' = IF back THEN {Last(s.loads)} ELSE {}

\* LaunchEnvLoads.withdraw: a load in effect gives way to the one before it.
Withdraw(L) ==
  IF L \notin Range(loads) THEN UNCHANGED <<env, loads, held>>
  ELSE IF Last(loads) # L
    THEN /\ loads' = Without(loads, L)
         /\ UNCHANGED <<env, held>>
  ELSE
    LET rest == Without(loads, L)
        outEnv == IF L \in held /\ env = "loaded" THEN "unset" ELSE env
        outHeld == IF L \in held /\ env = "unset" THEN held \ Range(loads) ELSE held
        prev == IF rest = <<>> THEN 0 ELSE Last(rest)
        back == prev \in outHeld /\ outEnv = "unset"
    IN /\ loads' = rest
       /\ env' = IF back THEN "loaded" ELSE outEnv
       /\ held' = IF prev \in outHeld /\ ~back THEN outHeld \ {prev} ELSE outHeld

\* launch-sequence.ts:prepareProject: a shutdown interrupts the launch while it prepares.
Interrupt(L) ==
  /\ st[L] = "preparing"
  /\ st' = [st EXCEPT ![L] = "withdrawn"]
  /\ CASE Mode = "none" -> UNCHANGED <<env, loads, held>>
       [] Mode = "unloadLast" ->
            /\ env' = Forgotten
            /\ loads' = <<>>
            /\ held' = {}
       [] Mode = "snapshot" -> Restore(L)
       [] Mode = "owned" -> Withdraw(L)
  /\ UNCHANGED <<snap, history>>

Next ==
  \/ \E L \in Launches : Start(L) \/ Load(L) \/ Complete(L) \/ Interrupt(L)
  \/ UserDelete

Spec == Init /\ [][Next]_vars

\* The loads and deletions of every launch not withdrawn: what process.env
\* must show, as if the withdrawn launches never ran.
Surviving == SelectSeq(history, LAMBDA e : e[1] = "delete" \/ st[e[2]] # "withdrawn")

LiveLaunchKeepsItsEnv ==
  (Surviving # <<>> /\ Last(Surviving)[1] = "load") => env = "loaded"

DeletedStaysDeleted ==
  (Surviving # <<>> /\ Last(Surviving)[1] = "delete") => env = "unset"

InterruptedLaunchLeavesNoEnv == Surviving = <<>> => env = "unset"
====
