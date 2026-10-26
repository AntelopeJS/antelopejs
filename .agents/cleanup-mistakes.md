# Cleanup mistakes

| Class | Caught | Example | Encoding idea |
| --- | --- | --- | --- |
| Lint suppression written before trying an owner-derived type or inference | link 3 rounds 1, 2, 3, 4 | `PromiseRejectedResult["reason"]`, `Parameters<typeof f>[0]`, dropped return annotation | a lint rule or a review check that flags `oxlint-disable` for anti-slop type rules when the parameter is private. |
| Directive reason that misstates the code | link 3 rounds 1, 2 | `tasks.ts` claimed write results are forwarded; `lazy-action.ts` claimed action results are forwarded | the verifier must probe each directive's claim against the code. |
| Count in a PR body written by hand | link 1 round 1 | oversize 14→11, actually 12 | generate ceiling tables from the JSON diff. |
