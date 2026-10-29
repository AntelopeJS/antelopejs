# Proof for AntelopeJS/antelopejs#263

Raw outputs of `verify-ajs` commands and checks, run from /home/antony/code/antelope/t6/antelopejs-v1fix.

| File | What it shows |
| --- | --- |
| `map-doors.log` | `verify-ajs map`, the break-coverage test, `doors` on each seeded door, and `map` failing with project-build's covers as on main |
| `plan-project-build-break.log` | `plan` on a scratch commit of the project-build seeded break |
| `smoke.log` | `new`, `doctor`, `journey smoke`, `clean` at the branch head |
| `seeded-with-control.log` | `seeded project-build smoke` against an unpatched control |
| `formal-gates/<scenario>.log`, `formal-gates-all.log` | a scratch commit, then `formal` and `verdict` in a scratch worktree: the gate's decision and the behaviour comparison |
| `checks.log` | `pnpm run checks` at the final head |
| `api-diff.log` | `antelopejs-api-diff origin/main` at the final head, with the suppression table |
| `suppressions.log` | `antelopejs-suppressions` (quiet on success) |
