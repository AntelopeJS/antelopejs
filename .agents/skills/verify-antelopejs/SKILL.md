---
name: verify-antelopejs
description: "Drive the ajs CLI and the @antelopejs/core runtime (createRuntime, launch) the way an app developer does, in an isolated HOME with an offline template source, and report the result with evidence. Use to prove a change to antelopejs works before merge, or to verify a PR."
---

# Verify antelopejs

Every deterministic step is a `verify-ajs` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `bin/journeys/` and name it in its feature file, then run it.

```bash
VERIFY=".agents/skills/verify-antelopejs/bin/verify-ajs.mts"
node "$VERIFY"            # lists every command
```

Node 24 runs the `.mts` files directly. Run from the repository root after `pnpm install --frozen-lockfile`.

## Launch

```bash
RUN=$(node "$VERIFY" new)            # builds dist, creates /tmp/verify-antelopejs/<id>
node "$VERIFY" new --no-build --no-base   # reuse dist, skip the base CLI
```

`new` builds `dist/`, then creates an isolated run:

- `HOME` is a fresh folder per journey under `$RUN/homes/<feature>/<journey>`. Environment is `CI=1`, `AJS_NO_UPDATE_CHECK=1`, `NO_COLOR=1`, npm offline. `pnpm` is a corepack shim with its own corepack home under the cache, so each fixture runs the pnpm version it pins, a folder that pins none runs the fixtures' version, and nothing asks the registry.
- The template source is offline: `$RUN/sources/interfaces.git` is a local git repo holding `manifest.json`. Its template points at `file://$RUN/sources/template-verify-http.git`, a copy of `fixtures/template-verify-http`. Journeys pass it with `-g`.
- The pnpm store is warm and shared across runs at `~/.cache/verify-antelopejs/xdg-data`. The first run fills it; later runs install offline.
- `--base <ref>` (default `origin/main`) builds the base CLI in a cached worktree so that journeys can compare against it.

## Doctor

```bash
node "$VERIFY" doctor "$RUN"
```

Doctor checks the following: the CLI is built and newer than `src/`, and `ajs --version` equals the package version. `HOME` belongs to the run, and the manifest is seeded. The store is warm, the driven `pnpm` is the version the fixtures pin, HEAD has not moved since `new`, and no recorded process is alive. Do not drive a run that fails doctor.

## Drive

```bash
node "$VERIFY" plan                          # diff to features, unmapped surfaces, and `command`
node "$VERIFY" plan --all                    # every feature, before a release
node "$VERIFY" journeys "$RUN" smoke cli-shell project-dev   # every journey of the features, at once
node "$VERIFY" journey "$RUN" project-dev [journey-id...]    # one feature, or chosen journeys
```

- Run the plan's `run` list in one command: `plan` prints it as `command`, so substitute your run for `$RUN` and run that. `journeys` runs the journeys of all the features at the same time, `--jobs <n>` journeys at once (default a quarter of the cores, 2 to 8; 4 on 16 cores), and prints each feature's `PASS`/`FAIL` lines together, in the order given. It writes each feature's `feature.json` when that feature's last journey ends, and exits non-zero when any journey failed. Journeys share nothing but the run folder: each has its own `HOME`, work folder, evidence folder and port, and each background process is recorded in its own `$RUN/processes/<pid>.json`. A feature that must not overlap its own journeys is declared in `SERIAL_FEATURES` of `bin/journeys/index.mts` with the reason; none is. `journey` runs one feature's journeys one after another, so use it only to rerun one feature or chosen journeys.
- Each feature file in [features/](features/README.md) lists its journeys, its source globs (`covers:`) and its docs pages (`docs:`).
- `ajs project dev` and `ajs project start` run in the background. The harness records their PID, waits for the fixture module's HTTP endpoint to answer, and stops them with SIGINT by recorded PID. A stop that does not exit within the timeout fails the journey.
- A run runs `ajs project init` for real in two places only: the `smoke` and `project-init` journeys, and one shared init, `shared/project-init`, that the first journey needing a project triggers. Every other journey copies that project into its own work folder, sets the offline manifest in its own `HOME` and reads the project back with `ajs project modules list`. Its step `project copied from the shared init` names the init's evidence, `$RUN/evidence/shared/project-init/`. If that init fails, it stays failed for the rest of the run: every journey that needs a project fails on its first step and names `$RUN/evidence/shared/project-init/result.json`, which keeps the real cause. Fix the cause, then start a new run with `verify-ajs new`; rerunning the journeys in the same run does not retry the init. A run that Ctrl-C stopped during the init leaves no result, and the next journey runs the init again.
- Every mutation is read back through a second command, for example `ajs project modules add` followed by `ajs project modules list`, or `ajs config set` followed by `ajs config get`.
- The library runtime is driven through `fixtures/hosts/*.mjs`, which import the built package the way a consumer does.

## Evidence

Each step writes `$RUN/evidence/<feature>/<journey>/<NN-step>/` with:

- `command.txt`, `stdout.txt`, `stderr.txt` and `exit-code.txt`
- `pid.txt` for background processes
- `tree.txt`, the resulting file tree without `node_modules`
- `http.json`, the HTTP response of the fixture module, when the step calls it

`result.json` holds each journey's checks, and `feature.json` holds the results of the whole feature. Read the evidence before you judge a PASS, because a check passing proves only what it asserts.

## Cleanup

```bash
node "$VERIFY" clean "$RUN"
```

`clean` kills what the run started, by the PIDs in `$RUN/processes/`, and removes everything except `evidence/` and `run.json`.

## What to run and judge

1. **Run every feature that `plan` lists in `run`.** `plan` also prints the command that runs them all as `command`. On a pull request that is every feature whose `covers:` globs the diff touches, plus the smoke journey (`init -> dev -> fixture call -> stop`). When the diff changes a file that the `shared` globs of `verify.config.ts` match, every feature depends on it, so `run` holds every feature and `full` names the shared files. A rename counts as a deletion plus an addition, so renaming a shared file away also runs every feature. Before a release, run `plan --all`, then every feature in `run` and `formal "$RUN" --all`.
2. **Map every surface.** User-facing code is `src/**`. A changed file there that no feature glob covers is an unmapped surface: `plan` lists it under `unmapped` and exits 1. The PR adds the feature file and its journeys. `map` checks the whole tree.
3. **Journeys.** Run whole features, not a hand-picked subset. A failing journey is a finding: read its evidence and say what it shows.
4. **Docs.** Each touched feature lists its `docs:` pages, which `plan` prints under `docs`. Judge every page against what the journeys showed. A stale page is a finding.
5. **Formal checks.** `verify.config.ts` lists each formal check with the source files it covers and its own files. `node "$VERIFY" formal "$RUN"` runs every check whose covered files or own files the diff touches and records its command, output and exit code under `evidence/formal/<name>/`. `--all` runs every check. A violated rule or a non-zero exit is a finding; the check's own skill says what each rule means.
6. **One-way doors.** `verify.config.ts` holds the path rules per kind (`data`, `format`, `contract`, `outbound`, `exposure`, `publish`). `node "$VERIFY" doors` prints the `One-way-door:` line for the diff and each flagged file. For each flagged file, say what cannot be undone and how it is contained, or why it is not a door.

Report the result in your own reply: FAIL when a journey, a docs page, a formal check or an unmapped surface shows a finding the change causes; PASS+NOTES when something is not verified or needs the owner's attention; PASS otherwise. Name the failing journeys, what their evidence showed, and the one-way doors. The evidence stays under `$RUN/evidence/` on the machine that ran the verification; nothing is posted to GitHub. A new push changes the head, so verify again on the new head.

## Gotchas

- The build is the one in `dist/`. Doctor fails when `src/` is newer, so rebuild with `new` instead of trusting an old `dist/`.
- Templates come only from the offline manifest. A journey that reaches the network is a harness bug.
- Each background process gets a free port from the kernel, so two runs never share an instance.
- `project dev` exits 130 on SIGINT; journeys assert it and that the port refuses connections afterwards.

## Feature map

[features/README.md](features/README.md).
