# Cleanup mistakes

Mistake classes a verifier caught at least twice during the five-link cleanup stack.

| Class | Caught | Example | Encoding idea |
| --- | --- | --- | --- |
| Lint suppression written before trying an owner-derived type or inference | link 3 rounds 1, 2, 3, 4 | `PromiseRejectedResult["reason"]`, `Parameters<typeof f>[0]`, dropped return annotation | a lint rule or a review check that flags `oxlint-disable` for anti-slop type rules when the parameter is private. |
| Directive reason that misstates the code | link 3 rounds 1, 2 | `tasks.ts` claimed write results are forwarded; `lazy-action.ts` claimed action results are forwarded | the verifier must probe each directive's claim against the code. |
| Count in a PR body written by hand | link 1 round 1, link 3 round 5 | oversize 14→11, actually 12; 119 directives reported where HEAD has 122, 33 SAFETY comments where HEAD has 32 | generate ceiling and directive tables from the JSON diff and `git grep`, never by hand. |
| Entry-only boundary bypassed through an exemption | link 4 rounds 1, 2 | `src/core/cli/public.ts` imports output files directly and `.dependency-cruiser.cjs` exempts it | the layer config should reject `pathNot` exemptions on entry-only rules; add a second entry instead. |
| Runtime contract changed where declarations and api-diff cannot see it | link 4 round 1, link 5 rounds 1, 2, 3, 4 | re-export turned writable exports into getters; split manager broke `Proxy` receivers and dropped `async`; rest delegates reported `length` 0; private constructor took an options object instead of positional `fs, state`; runtime forwarders lost `async` and their export order | diff the built packages' runtime surface (descriptors, async identity, `length`, positional calls, `Proxy` receivers) against the base on every link, not only `.d.ts`. |
