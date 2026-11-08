---
name: verify-antelopejs
description: "Drive the ajs CLI and the @antelopejs/core runtime (createRuntime, launch) the way an app developer does, in an isolated HOME with an offline template source, and report a verdict with evidence. Use to prove a change to antelopejs works before merge, or to verify a PR."
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
- A run runs `ajs project init` for real in two places only: the `smoke` and `project-init` journeys, and one shared init, `shared/project-init`, that the first journey needing a project triggers. Every other journey copies that project into its own work folder, sets the offline manifest in its own `HOME` and reads the project back with `ajs project modules list`. Its step `project copied from the shared init` names the init's evidence, `$RUN/evidence/shared/project-init/`. If that init fails, it stays failed for the rest of the run: every journey that needs a project fails on its first step and names `$RUN/evidence/shared/project-init/result.json`, which keeps the real cause. Fix the cause, then start a new run with `verify-ajs new`; rerunning the journeys in the same run does not retry the init. A run that Ctrl-C stopped during the init leaves no verdict, and the next journey runs the init again.
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

## Verdict rules

1. **Run every feature that `plan` lists in `run`.** `plan` also prints the command that runs them all as `command`. On a pull request that is every feature whose `covers:` globs the diff touches, plus the smoke journey (`init -> dev -> fixture call -> stop`). When the diff changes a file that the `shared` globs of `verify.config.ts` match, every feature depends on it, so `run` holds every feature and `full` names the shared files. A rename counts as a deletion plus an addition, so renaming a shared file away also runs every feature. Before a release, run `plan --all`, then every feature in `run`, `formal "$RUN" --all`, and render the verdict with `--all` (`verdict "$RUN" --pr <n> --all`): a verdict without `--all` gates on the diff's own features and smoke only, whatever `plan --all` printed.
2. **Unmapped surface fails the verdict.** User-facing code is `src/**`. A changed file there that no feature glob covers is an unmapped surface. The PR adds the feature file and its journeys. `map` checks the whole tree.
3. **Every registered journey of a feature in `run` must have run and passed.** A missing journey fails the verdict as "not run", so run whole features, not a hand-picked subset. Known findings stay as failing journeys, listed under `known:` in their feature file; `map` fails a `known:` id that is not a registered journey of that feature. A journey counts as known only when the feature file lists it on the base (the plan's `baseSha`) and at HEAD: a diff can remove an entry but cannot add the excuse for a failure it causes. A known journey fails a verdict only when the diff touches its feature: in a feature that runs only because of a shared file or `--all`, the verdict reports a failing known journey under Known findings. Every other failing journey fails the verdict, a non-known one in an untouched feature included.
4. **Docs.** Each touched feature lists its `docs:` pages. Judge every page against what the journeys showed. A stale page fails the verdict.
5. **Formal checks.** `verify.config.ts` lists each formal check with the source files it covers and its own files. Run `node "$VERIFY" formal "$RUN"` before the verdict: it runs every check whose covered files or own files the diff touches and records it under `evidence/formal/<name>/`. For each such check it also decides, without judgement, whether the diff changed what the covered code does: `emit` compares the structure of the covered files' JavaScript on the base and on HEAD: node kinds, names and literal values, with types, comments, formatting, parentheses and export keywords left out. Each use of an imported binding stands for its origin (the resolved module and the imported name), so an import retargeted to another module or alias counts as changed; a function declaration of a covered module is its name alone, and any other binding of a covered module is keyed by module and name. A function declaration refers to the top-level variables and classes of its own file by file and name, so moving it next to a different variable of the same name counts as changed. Exports are keyed by the origin they export, so a re-export or an export alias retargeted counts as changed. Each file must keep its top-level statements and side-effect imports in order; function declarations, which are hoisted, may move between covered files with their imports. So a type-only edit, a reformat or a moved function declaration counts as unchanged, while reordering statements or moving any other statement counts as changed. `emit` judges behaviour, not the public surface: exports are the api-diff's job; a check may instead name a `probe`, run on a checkout of each, whose output must match. Then:
   - a covered check that did not run, or exits non-zero (a tool error, or a check that no longer matches its record), fails the verdict;
   - recorded findings fail the verdict only when the covered behaviour changed; when it did not, the verdict reports them as known findings;
   - when the covered behaviour changed, or the diff changed the check's own `files`, `formal` also runs the check on the base. A rule the base broke counts as fixed only when HEAD reports it passing; a rule the base broke that HEAD does not report at all fails the verdict. A fix that leaves no violated rule passes.

   `--all` also runs the others, which the verdict shows without gating on them.
6. **One-way doors.** The section comes right after the result line and is mandatory; a verdict without it is void. It holds either `None` with a reason, or one row per door: kind, location, what cannot be undone, and containment. `verify.config.ts` holds the path rules per kind (`data`, `format`, `contract`, `outbound`, `exposure`, `publish`). `node "$VERIFY" doors` prints the `One-way-door:` line for the diff. Every file the path rules flag needs a row, or a `falsePositives` entry that says why it is not a door; an unadjudicated flag fails the verdict.
7. **Result.** FAIL if any of rules 1 to 6 fail. PASS+NOTES when something is not verified or needs the owner's attention. PASS otherwise.

Write your judgement to `$RUN/evidence/judgement.json`:

```json
{
  "doors": {
    "none": "the diff changes only the verification skill and tests",
    "rows": [],
    "falsePositives": [{ "kind": "contract", "location": "package.json", "reason": "only devDependencies changed" }]
  },
  "docs": [{ "page": "docs/1.get-started/3.quick-start.md", "matches": true, "note": "" }],
  "notVerified": ["What no journey reached, and why"],
  "attention": ["Behaviour the owner should look at that is not a bug the skill can judge"],
  "verifier": "https://ampcode.com/threads/T-…, a fresh thread that did not write the change"
}
```

A door row is `{ "kind", "location", "irreversible", "containment" }`, where `kind` is one of the `doors` keys of `verify.config.ts`. `verifier` is required.

Then render the verdict:

```bash
node "$VERIFY" verdict "$RUN" --pr <n>   # writes evidence/verdict.md; exit 1 on FAIL
node "$VERIFY" verdict "$RUN" --pr <n> --all   # pre-release: gates on every feature, as plan --all
```

- `verdict` computes the result from `feature.json`, the plan and your judgement. It writes `evidence/verdict.md` and prints it. The evidence stays under `$RUN/evidence/` on the machine that ran the verification.
- Report the verdict and what you saw in your own reply: the result, the failing journeys and what the evidence showed. Nothing is posted to GitHub.
- A new push changes the head, so verify again on the new head.

Judge a change only from a thread that did not write it, and name that thread in `verifier`.

## Trust

The skill is not Trusted yet. It becomes Trusted when it passes a shadow run of 10 consecutive agent PRs, and its last maintain pass (`maintain-verification-skill`, run by the gardener) is newer than the last change to the repo or its `@antelopejs` dependencies and at most 30 days old. The gardener enforces freshness; the verdict header says `not trusted yet` until then.

## Gotchas

- The build is the one in `dist/`. Doctor fails when `src/` is newer, so rebuild with `new` instead of trusting an old `dist/`.
- Templates come only from the offline manifest. A journey that reaches the network is a harness bug.
- Each background process gets a free port from the kernel, so two runs never share an instance.
- `project dev` exits 130 on SIGINT; journeys assert it and that the port refuses connections afterwards.

## Feature map

[features/README.md](features/README.md).
