## Verify: PASS+NOTES

**Head** `fe87cc8` · **Skill** `verify-antelopejs` @ `fe87cc8` (not trusted yet) · **Verifier** https://ampcode.com/threads/T-01a180be-9c8e-7585-ad6b-69ba2ef0b536

### One-way doors
None: the diff adds the verification and formal skills, a CI job pair, a property test and a dev dependency; no product source, exports, bin, config format or release setting changes
- Not a door: `package.json` matches the contract path rules. only the typecheck script (adds tsc -p .agents/skills/verify-antelopejs) and the devDependency fast-check 4.10.2 change; exports, bin, dependencies and peerDependencies are untouched, so nothing a consumer imports or runs changes
- Not a door: `package.json` matches the publish path rules. name, version, files and publishConfig are untouched; a devDependency and a script do not claim any registry name or change the published tarball

### Touched features
- none
- smoke: init → dev → fixture call → stop

### Journeys
| Feature | Entry point | Result | Evidence |
|---|---|---|---|
| smoke | `smoke`: ajs project init → ajs project dev → GET / → SIGINT | pass: init a project, run it with dev, call the fixture module, stop with SIGINT | [smoke/smoke](https://github.com/AntelopeJS/antelopejs/tree/verify-evidence/pr-243/fe87cc8da9bdc4c13e842c5c53a97d8ff4da3594/smoke/smoke) |

### Formal checks
- `formal-module-lifecycle` (does not cover the diff, informational): violated: NoOrphanGeneration, LaunchReadsCurrentConfig, ConfigEditsReachProject, NoCrashFromStaleWork. [evidence](https://github.com/AntelopeJS/antelopejs/tree/verify-evidence/pr-243/fe87cc8da9bdc4c13e842c5c53a97d8ff4da3594/formal/formal-module-lifecycle)
- `formal-interface-ranges` (does not cover the diff, informational): exit 0, no violated rule. [evidence](https://github.com/AntelopeJS/antelopejs/tree/verify-evidence/pr-243/fe87cc8da9bdc4c13e842c5c53a97d8ff4da3594/formal/formal-interface-ranges)

### Docs
- No touched feature links a page.

### Not verified
- Seeded breaks (node verify-ajs.mts seeded ...) were not run in this verification, so this run does not show that each feature's journeys catch its seeded break. For a PR whose main payload is the verifier itself, that is the strongest evidence the skill works, and the Trust section requires it.
- Only the smoke journey ran, because the plan maps no src/** change. The other 14 features and their journeys added by this PR were not driven here.
- docs/1.get-started/3.quick-start.md (the smoke feature's docs page) was not judged against behaviour: the smoke journey uses the offline 'Verify HTTP' template, while the page uses 'Blank Typescript' and --watch, which no journey in this run exercised.
- The new CI jobs (verify-map, formal-module-lifecycle) were not run in GitHub Actions here; map and the formal check were run locally with Node 24.22.1 and Temurin 21.0.13.

### Attention
- formal-module-lifecycle (run with --all, informational because no covered src file changed) reports four violated rules on main: NoOrphanGeneration, LaunchReadsCurrentConfig, ConfigEditsReachProject, NoCrashFromStaleWork. check.mjs exits 0 because each matches its recorded finding (F1 to F4) and counterexample length. These are documented real bugs in ajs project dev (orphan generation after Ctrl+C during async provide, restart reading a cached config, an edit lost during startup, and a restart crashing dev with exit 1). They are not introduced by this PR, but once merged, any PR touching the covered files will FAIL its verdict until they are fixed, because the verdict gates on any violated rule, recorded findings included.
- This PR adds the verifier that is judging it. The verdict therefore cannot vouch for the skill's own correctness beyond smoke, map, doors and the two formal checks running cleanly.
- CI: verify-map pins node-version 24 while formal-module-lifecycle reads .nvmrc; harmless today, but they can drift. formal-module-lifecycle downloads tla2tools 1.7.4 from GitHub on a cold cache and is now required by the checks job.
- test/core/module-manager.interface-ranges.test.ts is matched by the unit test glob, so the property test (about 15 s) now runs inside pnpm test as well as in the formal-interface-ranges check.

Evidence: `verify-evidence` branch, [`pr-243/fe87cc8da9bdc4c13e842c5c53a97d8ff4da3594/`](https://github.com/AntelopeJS/antelopejs/tree/verify-evidence/pr-243/fe87cc8da9bdc4c13e842c5c53a97d8ff4da3594/)
