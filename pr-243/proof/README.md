# Proof for AntelopeJS/antelopejs#243 and AntelopeJS/interface-core#47

These are the raw outputs behind the claims in both PR bodies. Run folders keep the layout that `verify-ajs` writes: `<feature>/<journey>/<NN-step>/` holds `command.txt`, `stdout.txt`, `stderr.txt`, `exit-code.txt`, `tree.txt` and `http.json`.

| File | What it shows | Code |
|---|---|---|
| `seeded-with-control.log` | All 15 seeded breaks are caught. Each is caught by a journey that passes in an unpatched control and fails a check with the patch. | antelopejs `5080795` |
| `runs/seeded/<run>/<feature>/` | The control runs and the patched runs that the log names. | same |
| `seeded-v1-without-control.log` | The first seeded run, before the control existed: cli-shell MISSED, then fixed. | uncommitted tree before `fb1223f` |
| `seeded-doors.log` | `verify-ajs doors` flags each of the 6 seeded doors. | `fe87cc8` |
| `full-run-main.log` | Every journey on unchanged `src/`: 62 pass. The 4 failures are 2 findings and 2 base-compat journeys run without a base CLI. | uncommitted tree before `fb1223f` |
| `end-to-end-run.log`, `runs/end-to-end-20261028T031319-e957b7/` | `new`, `doctor`, smoke and 5 features, base-compat, then `clean`. Only `evidence/` and `run.json` remain. | `ba6fa17` |
| `formal/lifecycle-check.log`, `formal/lifecycle-check-after-layout-fix.log` | TLC 1.7.4: 5 rules hold, and the 4 findings break at their recorded lengths. | `95e3199`, `fe87cc8` |
| `formal/lifecycle-scratch-Stopping-guard.log` | Removing the `Stopping(L)` guard in `LaunchWatch` gives `BROKEN DevSurvivesFailedReload`, exit 1. | `95e3199` plus the scratch change |
| `formal/statechart-*.png`, `formal/stories-config.md` | The `pstack:statechart` views of the model. | `95e3199` |
| `formal/interface-ranges-proof.txt` | The fast-check range properties and 4 scratch breaks. | `fb1223f` |
| `formal-gate-probe-plan.json` | The plan of a scratch commit that touches `config-loader.ts`. Its verdict failed on the 4 violated rules. | `5080795` plus a scratch commit |
| `interface-core/*.log` | The property on interface-core `main`, and on each of the 3 scratch mutations. | interface-core `6364275` |
| `checks.log`, `api-diff-main.log`, `baseline-checks-main.log` | `pnpm run checks` (7 passed) and `antelopejs-api-diff main` (unchanged) at `95e3199`, and the baseline checks on `main`. | as named |
| `comment-sicko-report.md` | The `pstack:no-comments` report. | before `fb1223f` |

The decision trail is `../decision-trail.tsv`.
