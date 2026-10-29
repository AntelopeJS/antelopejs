# Fix round proof for AntelopeJS/antelopejs#263

Each `formal-gates/<scenario>.log` is a scratch commit on top of the branch head, then `verify-ajs formal` and `verdict` in the scratch worktree.

| Scenario | Change | Gate |
| --- | --- | --- |
| order-swap | two top-level constants swapped in process-claim.ts | FAIL |
| statement-move | a top-level constant moved between two covered files | FAIL |
| type-reflow | a long type annotation reflowed by oxfmt | PASS, known findings |
| format-only | redundant parentheses, quote style, a line break | PASS, known findings |
| comment-only | a TSDoc comment | PASS, known findings |
| import-alias | shutdown-manager.ts imports FAILURE_EXIT_CODE as CANCELLED_EXIT_CODE | FAIL |
| lifecycle-move | a function declaration moved between covered files, re-exported | PASS, known findings |
| lifecycle-behaviour-change | shutdown priority 5 instead of 30 | FAIL |
| ranges-behaviour-change | a message changed in a covered file of the ranges check (the check has no recorded finding) | PASS, behaviour changed, no violated rule |
| ranges-doc-only | a TSDoc change | PASS, unchanged |

`checks.log` is `pnpm run checks`. The unit cases of the comparison itself are `.agents/skills/verify-antelopejs/bin/lib/behaviour.test.mts`, the gate cases `formal.test.mts`, the map call site `map.test.mts`.
