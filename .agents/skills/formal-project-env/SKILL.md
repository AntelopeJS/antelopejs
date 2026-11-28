---
name: formal-project-env
description: TLA+ model of overlapping launches of one project that load its `.env` into the process-global `process.env` and withdraw those loads when a shutdown interrupts them while they prepare, checked with TLC, plus a map test that runs every order of the same actions on the real `project-env.ts`. Use when a change touches a file in its coverage record, or when a change to loading, keeping or withdrawing the project `.env` needs proof that no launch removes what another loaded.
---

# Formal check: project .env loads of overlapping launches

Two launches of one project each load its `.env` while they prepare. A launch that a shutdown interrupts meanwhile withdraws what it loaded, and something outside the launches may delete a variable at any time. `process.env` is shared by the whole process, so one launch's withdrawal can remove what another loaded. `EnvLoads.tla` models one variable of that `.env`, and the constant `Mode` picks the withdrawal design of the code at a given commit. TLC checks every interleaving of two launches.

## Run it

```sh
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test .agents/skills/formal-project-env/*.test.mjs
node .agents/skills/formal-project-env/check.mjs
```

The map test needs Node 24 and `pnpm install` done. It imports `src/core/config/project-env.ts` through Node's type stripping and takes under a second. `check.mjs` also needs Java 11 or later from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image. The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal`. The four configurations take about 15 s and explore at most 307 states each. CI runs both as the `formal-project-env` job.

- Exit 0 means every rule held or broke as `RUNS` in `check.mjs` records, each finding with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks.
- Exit 2 means TLC or Java could not run.

## The rules

`process.env` must show what the launches that were not withdrawn loaded and what was deleted since, as if the withdrawn launches never ran. `Surviving` is the history of loads and deletions with the loads of withdrawn launches left out, and its last entry says what the variable must be.

| Rule | Plain sentence | On main |
| --- | --- | --- |
| `LiveLaunchKeepsItsEnv` | When the last surviving entry is a load, the variable is set. | holds |
| `DeletedStaysDeleted` | When the last surviving entry is a deletion, the variable is unset. | holds |
| `InterruptedLaunchLeavesNoEnv` | When no entry survives, the variable is unset. | holds |

`TypeOK` holds in every configuration.

## Configurations

| Configuration | `Mode` | What it models | Result |
| --- | --- | --- | --- |
| `EnvLoads` | `owned` | The code on main: each launch withdraws only its own loads, and a withdrawn load in effect gives way to the one before it (#596). | Every rule holds. |
| `EnvLoadsBefore596` | `snapshot` | A launch records the last load when it starts and restores it when interrupted (#594). | All three rules break. |
| `EnvLoadsBefore594` | `unloadLast` | An interrupted launch unloads the last load of the file, whoever made it (#588). | `LiveLaunchKeepsItsEnv` breaks. |
| `EnvLoadsBefore588` | `none` | An interrupted launch withdraws nothing. | `DeletedStaysDeleted` and `InterruptedLaunchLeavesNoEnv` break. |

## The map test

`EnvLoads.map.test.mjs` runs every sequence of the model's actions for two launches on the real code, each sequence in a project of its own, and checks the three rules after each step. It replays 1161 sequences. Its `ACTIONS` table is the map from each action to the code that runs it.

Run on the code before each fix, with the same actions mapped to that code's functions, it breaks the same rules as the configuration of that commit. A model whose `Mode` drifts from the code it stands for shows as a rule that breaks in one and holds in the other.

## Real bug or modeling error

A counterexample of `EnvLoads` is a modeling error when the map test passes on the same order of actions. Fix the action that differs from the code and keep the rule. When the map test fails too, the code breaks the rule: fix the code.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `\* file.ts:name` comment on each, update `ACTIONS` in the map test, and rerun both.
- Never weaken or drop a rule to make the check pass.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `Start` | `prepareProject` (src/core/runtime/launch-sequence.ts): `new LaunchEnvLoads()` |
| `Load` | `LaunchEnvLoads.record` around `loadProjectEnv` (src/core/config/project-env.ts), `dropSupersededLoads` |
| `Complete` | `LaunchEnvLoads.keep`, `dropSupersededLoads` |
| `Interrupt` | `LaunchEnvLoads.withdraw`, `withdrawLoad`, `putOutOfEffect`, `putBackInEffect` |
| `UserDelete` | `delete process.env[name]` by anything outside the launches |

The sync commit is `7ad211899f4993a75ee45f0b0d858597e9517fae` on AntelopeJS/antelopejs `main`.

## Bounds and what is left out

Two launches, one load each, one variable with one value. A pass covers these bounds only.

The model leaves out:

- a launch that loads the `.env` more than once, such as the config reload of `ts-config-file.ts`;
- a `.env` edited between loads, so that two loads set different values, and a variable that something else sets;
- a load made outside `LaunchEnvLoads.record`, which no launch may withdraw;
- the wait of the shutdown for the preparation to settle: `Interrupt` stands for the withdrawal that runs once it has.
