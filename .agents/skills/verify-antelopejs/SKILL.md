---
name: verify-antelopejs
description: "Drive the ajs CLI and the @antelopejs/core runtime (createRuntime, launch) the way an app developer does, in an isolated HOME with an offline template source, and post a verdict with evidence. Use to prove a change to antelopejs works before merge, to verify a PR, or to check that a seeded break is caught."
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

- `HOME` is a fresh folder per journey under `$RUN/homes/<feature>/<journey>`. Environment is `CI=1`, `AJS_NO_UPDATE_CHECK=1`, `NO_COLOR=1`, npm offline.
- The template source is offline: `$RUN/sources/interfaces.git` is a local git repo holding `manifest.json`. Its template points at `file://$RUN/sources/template-verify-http.git`, a copy of `fixtures/template-verify-http`. Journeys pass it with `-g`.
- The pnpm store is warm and shared across runs at `~/.cache/verify-antelopejs/xdg-data`. The first run fills it; later runs install offline.
- `--base <ref>` (default `origin/main`) builds the base CLI in a cached worktree so that journeys can compare against it.

## Doctor

```bash
node "$VERIFY" doctor "$RUN"
```

Doctor checks the following: the CLI is built and newer than `src/`, and `ajs --version` equals the package version. `HOME` belongs to the run, and the manifest is seeded. The store is warm, HEAD has not moved since `new`, and no recorded process is alive. Do not drive a run that fails doctor.

## Drive

```bash
node "$VERIFY" plan                          # diff to features, unmapped surfaces
node "$VERIFY" journey "$RUN" smoke
node "$VERIFY" journey "$RUN" project-dev [journey-id...]
```

- Each feature file in [features/](features/README.md) lists its journeys, its source globs (`covers:`) and its docs pages (`docs:`).
- `ajs project dev` and `ajs project start` run in the background. The harness records their PID, waits for the fixture module's HTTP endpoint to answer, and stops them with SIGINT by recorded PID. A stop that does not exit within the timeout fails the journey.
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

`clean` kills what the run started, by recorded PID, and removes everything except `evidence/` and `run.json`.

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey** (`init -> dev -> fixture call -> stop`). `plan` prints that list as `run`.
2. **Unmapped surface fails the verdict.** User-facing code is `src/**`. A changed file there that no feature glob covers is an unmapped surface. The PR adds the feature file, its journeys and its seeded break. `map` checks the whole tree.
3. **Every registered journey of a feature in `run` must have run and passed.** A missing journey fails the verdict as "not run", so run whole features, not a hand-picked subset. Known findings stay as failing journeys. They fail a verdict only when the diff touches their feature.
4. **Docs.** Each touched feature lists its `docs:` pages. Judge every page against what the journeys showed. A stale page fails the verdict.
5. **Formal checks.** `verify.config.ts` lists each formal check with the source files it covers. Run `node "$VERIFY" formal "$RUN"` before the verdict: it runs every check that covers the diff and records it under `evidence/formal/<name>/`. For each such check it also decides, without judgement, whether the diff changed what the covered code does: `emit` compares the JavaScript statements of the covered files on the base and on HEAD (types, comments, formatting, imports and export keywords left out, so a verbatim move between covered files counts as unchanged); a check may instead name a `probe`, run on a checkout of each, whose output must match. Then:
   - a covered check that did not run, or exits non-zero (a tool error, or a check that no longer matches its record), fails the verdict;
   - recorded findings fail the verdict only when the covered behaviour changed; when it did not, the verdict reports them as known findings;
   - when the covered behaviour changed, `formal` also runs the check on the base and reports the rules the base broke that HEAD no longer does as fixed; a fix that leaves no violated rule passes.

   `--all` also runs the others, which the verdict shows without gating on them.
6. **One-way doors.** The section comes right after the result line and is mandatory; a verdict without it is void. It holds either `None` with a reason, or one row per door: kind, location, what cannot be undone, and containment. `verify.config.ts` holds the path rules per kind (`data`, `format`, `contract`, `outbound`, `exposure`, `publish`). `node "$VERIFY" doors` prints the `One-way-door:` line for the diff. Every file the path rules flag needs a row, or a `falsePositives` entry that says why it is not a door; an unadjudicated flag fails the verdict. A Data or Format door is contained only by one of that kind's `containments` journeys in `verify.config.ts` (an old `build.json` or config read by the new code), passing in this run. Name it as `feature/journey` in the row.
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

A door row is `{ "kind", "location", "irreversible", "containment", "containmentJourney" }`, where `kind` is one of the `doors` keys of `verify.config.ts`. `verifier` is required.

Then render and publish:

```bash
node "$VERIFY" verdict "$RUN" --pr <n>   # writes evidence/verdict.md; exit 1 on FAIL
node "$VERIFY" publish "$RUN" --pr <n>
```

- `verdict` computes the result from `feature.json`, the plan and your judgement. It renders the comment in the shape of `prototype/verification-bar/sample-verdict.md` from Upd4ting/outer-loop.
- `publish` commits `evidence/` to the orphan branch `verify-evidence` under `pr-<n>/<sha>/`. It works from a temporary worktree and never touches the checkout under review. It then posts the verdict with `gh pr comment` and sets commit status `verify` on the head SHA: `success` for PASS and PASS+NOTES, `failure` for FAIL. Finally it reads the status back from GitHub.
- A new push invalidates the status, so verify again on the new head.

Post a verdict only from a thread that did not write the change, and name that thread in `verifier`.

## Trust

The skill is not Trusted yet. It becomes Trusted when it catches every seeded break, passes a shadow run of 10 consecutive agent PRs, and its last maintain pass (`maintain-verification-skill`, run by the gardener) is newer than the last change to the repo or its `@antelopejs` dependencies and at most 30 days old. The gardener enforces freshness; the verdict header says `not trusted yet` until then.

## Seeded breaks

```bash
node "$VERIFY" seeded smoke project-init
```

`seeded-breaks/<feature>.patch` is one minimal product-code bug per feature that the feature's journeys must catch. `seeded` builds an unpatched control worktree and a patched one, runs the feature's journeys in both, and prints `CAUGHT` with the journeys that caught it, or `MISSED`. A break is caught only when a journey that passes in the control fails one of its checks with the patch. Journeys that already fail without the patch, and failures with no failing check (harness errors), do not count. It exits 0 only when every break is caught. `seeded-doors/<kind>.patch` holds one change per door kind; `node "$VERIFY" doors <patch>` must flag its kind.

## Gotchas

- The build is the one in `dist/`. Doctor fails when `src/` is newer, so rebuild with `new` instead of trusting an old `dist/`.
- Templates come only from the offline manifest. A journey that reaches the network is a harness bug.
- `publish` needs a `gh` token that can push to the repository and write commit statuses (`statuses: write`). A GitHub App token without it gets HTTP 403 on the status after the evidence and the comment are already posted. Rerun `publish` with a token that has it.
- Each background process gets a free port from the kernel, so two runs never share an instance.
- `project dev` exits 130 on SIGINT; journeys assert it and that the port refuses connections afterwards.

## Feature map

[features/README.md](features/README.md).
