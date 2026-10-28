# Comment Sicko report (pstack:no-comments)

Subagent TU-034nWe1y2ct6EWvX1wNshB, run on the antelopejs working tree before commit fb1223f and on interface-core `git diff origin/main` at 0169a71.

## interface-core

No edits. Kept: the two `SAFETY:` comments above the `AsyncProxyProtocol` and `RegisteringProxyProtocol` casts in `src/index.ts`. `IsInterfaceProxy` checks `brand.kind`, which only the `AsyncProxy` and `RegisteringProxy` constructors set. Also kept: the new TSDoc sentence on `ImplementInterface`.

MUST KILL, left open as an API change: `IsInterfaceProxy` returns `boolean` instead of a type predicate, which is the only reason for both casts.

## antelopejs

5 deletions and 15 rewrites, all comment text.

Deleted, as TSDoc on items that are not exported:
- `verify.config.ts`: `DoorKind`, `DoorRule` and `VerifyConfig`;
- `sources.mts`: `warmStore`, whose claim that it is the only step that reaches the registry was false;
- `verdict.mts`: `JudgementFile`.

Rewritten because the old comment was false or incomplete:
- `checks.mts`: `answers`, `refused` and `unchanged`;
- `evidence.mts`: `recordTree`;
- `run.mts`: `CACHE_DIR`;
- `lifecycle.mts`: `clean`;
- `project.mts`: `installFixture`;
- `sources.mts`: `seedSources`;
- `verdict.mts`: `renderVerdict`;
- `journey.mts`: `JourneyContext`, `waitReady`, `settle`, `stop` and `killGroup`;
- `journeys/index.mts`: `FEATURE_JOURNEYS`.

There are no suppressions in scope. The edited modules still import under Node type stripping.
