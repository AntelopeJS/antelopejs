# Changelog

## v1.23.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.22.0...v1.23.0)

### 💅 Refactors

- **core:** ⚠️  Type the published translator and stream write, and decode test setup overrides ([#460](https://github.com/AntelopeJS/antelopejs/pull/460))

### 📖 Documentation

- **changelog:** Upgrade notes of core 1.22.0 ([#459](https://github.com/AntelopeJS/antelopejs/pull/459))

#### ⚠️ Breaking Changes

- **core:** ⚠️  Type the published translator and stream write, and decode test setup overrides ([#460](https://github.com/AntelopeJS/antelopejs/pull/460))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.22.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.21.3...v1.22.0)

### Upgrade notes

1.22.0 is a minor release. It raises the `@antelopejs/interface-core` requirement, and that change carries the compile breaks below. Ranges such as `<2` accept it.

#### Requirements

- **`@antelopejs/interface-core` `>=0.5.1 <0.6.0`** (was `>=0.4.0 <0.5.0`) ([#458](https://github.com/AntelopeJS/antelopejs/pull/458)).
  - When a package-manager override or resolution forces core's own copy outside that range, core refuses to load with `@antelopejs/core 1.22.0 requires @antelopejs/interface-core >=0.5.1 <0.6.0, but it loads <version>`. Drop the override or raise it to 0.5.1.
  - Raise the interface-core range of your modules and interface packages to `>=0.5.1 <0.6.0`, so they share core's copy.
- interface-core 0.5.1 was published on 2026-11-13. A package manager that enforces a minimum release age, such as pnpm's `minimumReleaseAge`, refuses to install it until that age has passed. Add it to the exclusions or wait.

#### Types from interface-core 0.5

- Two type arguments no longer compile: `AsyncProxy<T, R>` fails with TS2707 and `InterfaceFunction<T, R>()` with TS2558. Both take a single type argument, the function type, and read the result type from it: `new AsyncProxy<(id: string) => Promise<User>>()`, `InterfaceFunction<(id: string) => Promise<User>>()` ([#458](https://github.com/AntelopeJS/antelopejs/pull/458)).
- A `test.setup` hook returns `AntelopeTestOverrides`, which is `Partial<AntelopeConfig>` without `test`. A `test` section returned from `setup` no longer compiles. It never took effect: the run kept the loaded `test.setup` and `test.cleanup`.

#### No other API change

- The other changes in this release remove lint suppressions and keep every published declaration and behaviour ([#453](https://github.com/AntelopeJS/antelopejs/pull/453), [#454](https://github.com/AntelopeJS/antelopejs/pull/454), [#455](https://github.com/AntelopeJS/antelopejs/pull/455), [#456](https://github.com/AntelopeJS/antelopejs/pull/456)). Two side effects show only in diagnostics:
  - A module whose main exports a lifecycle callback that is not a function still fails when that phase runs, with the same message. Under `--verbose`, the stack now starts in the module loader ([#455](https://github.com/AntelopeJS/antelopejs/pull/455)).
  - The walk that neutralizes interface proxies in module tests no longer recurses. A very deep export graph, 20,000 levels in our probe, now completes instead of overflowing the stack ([#456](https://github.com/AntelopeJS/antelopejs/pull/456)).

### 💅 Refactors

- **test:** Remove the suppressions from the tests and verify fixtures ([#454](https://github.com/AntelopeJS/antelopejs/pull/454))
- Replace the thrown-value, untyped-require and small-rule suppressions with typed boundaries ([#455](https://github.com/AntelopeJS/antelopejs/pull/455))
- **config:** Type the module sources and the stub export walk, and drop the config assertions ([#456](https://github.com/AntelopeJS/antelopejs/pull/456))

### 📖 Documentation

- **readme:** Add the Ecosystem section with the framework module table ([#452](https://github.com/AntelopeJS/antelopejs/pull/452))

### 📦 Build

- **playground:** Mark the demo packages private so the API proof skips them ([#453](https://github.com/AntelopeJS/antelopejs/pull/453))
- **deps:** Adopt @antelopejs/interface-core 0.5 ([#458](https://github.com/AntelopeJS/antelopejs/pull/458))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.21.3

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.21.2...v1.21.3)

### 🔥 Performance

- **cli:** Enable the Node compile cache in the ajs CLI ([#438](https://github.com/AntelopeJS/antelopejs/pull/438))
- **config:** Keep jiti's file cache when reloading antelope.config.ts ([#439](https://github.com/AntelopeJS/antelopejs/pull/439))
- **cli:** Run a local module's install commands once per modules install ([#440](https://github.com/AntelopeJS/antelopejs/pull/440))
- **repl:** Load node:repl only when the interactive session opens ([#450](https://github.com/AntelopeJS/antelopejs/pull/450))

### 🩹 Fixes

- **verify:** Drop base CLI comparisons that predate module locks on main ([#443](https://github.com/AntelopeJS/antelopejs/pull/443))

### 📖 Documentation

- **skills:** Show the EmbeddedInterfaces declaration for runtime.use and provide ([#444](https://github.com/AntelopeJS/antelopejs/pull/444))
- **embedded:** State the provides and EmbeddedInterfaces requirements of provide() ([#445](https://github.com/AntelopeJS/antelopejs/pull/445))
- **cli:** Document that writeData and Ui.json take JSON-typed data ([#446](https://github.com/AntelopeJS/antelopejs/pull/446))
- **readme:** Fix the dead stars badge, film and star-history links ([#449](https://github.com/AntelopeJS/antelopejs/pull/449))

### 📦 Build

- **deps:** Bump @antelopejs/tooling-configs to 0.5.0 ([#442](https://github.com/AntelopeJS/antelopejs/pull/442))
- **deps:** Bump @antelopejs/tooling-configs to 0.5.1 ([#448](https://github.com/AntelopeJS/antelopejs/pull/448))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.21.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.21.1...v1.21.2)

### 🚀 Enhancements

- **verify:** Run every feature when a shared file changes or before a release ([#405](https://github.com/AntelopeJS/antelopejs/pull/405))
- **cli:** Check interface versions at modules install and update, and share the highest accepted copy ([#412](https://github.com/AntelopeJS/antelopejs/pull/412))

### 🔥 Performance

- **core:** Match require.cache paths without repeating path work ([#401](https://github.com/AntelopeJS/antelopejs/pull/401))
- **test:** Run ts-node in transpile-only mode ([#402](https://github.com/AntelopeJS/antelopejs/pull/402))
- **verify:** Run ajs project init once per run and copy it into journeys ([#406](https://github.com/AntelopeJS/antelopejs/pull/406))
- **test:** Run the unit suite in mocha parallel mode with 4 workers ([#407](https://github.com/AntelopeJS/antelopejs/pull/407))
- **verify:** Run a plan's journeys concurrently ([#408](https://github.com/AntelopeJS/antelopejs/pull/408))

### 🩹 Fixes

- **verify:** Run the pnpm version the fixtures pin ([#404](https://github.com/AntelopeJS/antelopejs/pull/404))
- **verify:** Cover module-locks, add-action and interface-core-guard by the features that run them ([#403](https://github.com/AntelopeJS/antelopejs/pull/403))
- **cli:** Add the first entry of an empty object the way the formatter lays it out ([#409](https://github.com/AntelopeJS/antelopejs/pull/409))
- **watch:** Skip a missing watch folder instead of crashing dev --watch ([#421](https://github.com/AntelopeJS/antelopejs/pull/421))
- **cli:** Key a local module without a package.json name by its folder name ([#428](https://github.com/AntelopeJS/antelopejs/pull/428))
- **config:** Resolve config variables from the provider's own keys only ([#427](https://github.com/AntelopeJS/antelopejs/pull/427))
- **verify:** Check module test -f against the current folder, as the docs say ([#423](https://github.com/AntelopeJS/antelopejs/pull/423))
- **cli:** Show a failed command's stdout after its stderr ([#411](https://github.com/AntelopeJS/antelopejs/pull/411))
- **cli:** Let ajs config reset replace a config file it cannot read ([#433](https://github.com/AntelopeJS/antelopejs/pull/433))
- **skills:** Let /statechart read the lifecycle map and stop reporting the exit as a deadlock ([#425](https://github.com/AntelopeJS/antelopejs/pull/425))
- **test:** Replace the cli entry load budget with an allowlist of eager files ([#413](https://github.com/AntelopeJS/antelopejs/pull/413))
- **cli:** Show the rebuild hint when project start finds no build ([#422](https://github.com/AntelopeJS/antelopejs/pull/422))
- **cli:** Keep a dev restart running when a destroyed generation's work fails ([#420](https://github.com/AntelopeJS/antelopejs/pull/420))
- **core:** Type the remaining explicit any parameters ([#434](https://github.com/AntelopeJS/antelopejs/pull/434))
- **modules:** Announce ModulesStopping when the project stops before its modules started ([#410](https://github.com/AntelopeJS/antelopejs/pull/410))
- **downloaders:** Keep only the exact versions npm view and a packed package.json report ([#430](https://github.com/AntelopeJS/antelopejs/pull/430))
- **config:** Check antelope.config.ts against the AntelopeConfig contract when it loads ([#414](https://github.com/AntelopeJS/antelopejs/pull/414))
- **cli:** Refuse a non-empty directory in ajs module init . and ajs project init ([#424](https://github.com/AntelopeJS/antelopejs/pull/424))
- **cli:** Write the module manifest the way the template's formatter lays it out ([#426](https://github.com/AntelopeJS/antelopejs/pull/426))
- **config:** Reject provider config variables that are not a string, number or boolean ([#416](https://github.com/AntelopeJS/antelopejs/pull/416))
- **watch:** Notice a config or .env edit made before the watcher starts ([#419](https://github.com/AntelopeJS/antelopejs/pull/419))
- **runtime:** Stop an interrupted watch restart from exiting the process ([#435](https://github.com/AntelopeJS/antelopejs/pull/435))
- **downloaders:** Register loaders only under the source types a module declares ([#415](https://github.com/AntelopeJS/antelopejs/pull/415))
- **modules:** Construct nothing once a shutdown began ([#417](https://github.com/AntelopeJS/antelopejs/pull/417))

### 💅 Refactors

- **verify-antelopejs:** Remove publish, its evidence branch, comment and status ([#437](https://github.com/AntelopeJS/antelopejs/pull/437))

### 📖 Documentation

- **readme:** Add animated banners and a star history ([#436](https://github.com/AntelopeJS/antelopejs/pull/436))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.21.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.21.0...v1.21.1)

### 🩹 Fixes

- **core:** Work with consumers that pin an old interface-core or target ES2020 ([#400](https://github.com/AntelopeJS/antelopejs/pull/400))

### 📦 Build

- **deps:** Bump @antelopejs packages to the 2026-11-06 releases ([#399](https://github.com/AntelopeJS/antelopejs/pull/399))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.21.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.20.0...v1.21.0)

### 🩹 Fixes

- **cli:** Write antelope.config.ts the way oxfmt formats it ([#392](https://github.com/AntelopeJS/antelopejs/pull/392))
- Run the ajs tooling on Windows and keep a mid-path tilde in local module paths ([#390](https://github.com/AntelopeJS/antelopejs/pull/390))
- **cli:** Edit antelope.config.ts in place when project commands write it ([#391](https://github.com/AntelopeJS/antelopejs/pull/391))
- **project:** Keep envOverrides values out of build.json and read them at start ([#394](https://github.com/AntelopeJS/antelopejs/pull/394))
- **deps:** Update mocha to 12 and brace-expansion to resolve runtime advisories ([#396](https://github.com/AntelopeJS/antelopejs/pull/396))
- **skills:** Route the embedded or standalone interface choice to ajs-author-interface ([#398](https://github.com/AntelopeJS/antelopejs/pull/398))

### 🏡 Chore

- **verify:** Remove seeded runs from the verification skill ([#393](https://github.com/AntelopeJS/antelopejs/pull/393))
- **ci:** Remove the weekly mutation caller ([#395](https://github.com/AntelopeJS/antelopejs/pull/395))

### 🤖 CI

- Call ci-node.yml@v1 ([#397](https://github.com/AntelopeJS/antelopejs/pull/397))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.20.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.19.0...v1.20.0)

### 🚀 Enhancements

- **cli:** Accept template slugs in --template ([#377](https://github.com/AntelopeJS/antelopejs/pull/377))
- **cli:** Skip the host install for templates that install themselves ([#381](https://github.com/AntelopeJS/antelopejs/pull/381))

### 🩹 Fixes

- **cli:** Print next steps that run without a global ajs ([#379](https://github.com/AntelopeJS/antelopejs/pull/379))
- **cli:** Let project init read another template registry ([#380](https://github.com/AntelopeJS/antelopejs/pull/380))

### 📖 Documentation

- Send questions and ideas to Discord ([#362](https://github.com/AntelopeJS/antelopejs/pull/362))
- Create projects with npx @antelopejs/core ([#378](https://github.com/AntelopeJS/antelopejs/pull/378))
- **readme:** Show the framework film and the provider swap GIF ([9386547](https://github.com/AntelopeJS/antelopejs/commit/9386547))

### 🏡 Chore

- Land the cleanup campaign on main ([#389](https://github.com/AntelopeJS/antelopejs/pull/389))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.19.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.18.2...v1.19.0)

### 🚀 Enhancements

- **build:** Validate interface ranges at build and modules install ([#264](https://github.com/AntelopeJS/antelopejs/pull/264))
- **modules:** Record module lockfiles in antelope-lock/ and add build --frozen-modules ([#265](https://github.com/AntelopeJS/antelopejs/pull/265))

### 🩹 Fixes

- **modules:** End a start that misses its deadline instead of hanging ([#352](https://github.com/AntelopeJS/antelopejs/pull/352))

### 📖 Documentation

- **readme:** List PostgreSQL as a provider and link the DMS ([#342](https://github.com/AntelopeJS/antelopejs/pull/342))
- **readme:** Use one Discord invite ([#332](https://github.com/AntelopeJS/antelopejs/pull/332))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](https://github.com/alessaloisio))
- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.18.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.18.1...v1.18.2)

### 🩹 Fixes

- **resolution:** Keep links inside an instance copy so pnpm dependencies resolve ([#270](https://github.com/AntelopeJS/antelopejs/pull/270))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.18.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.18.0...v1.18.1)

### 🩹 Fixes

- **cli:** Leave the template's agent layer out of scaffolded projects ([#262](https://github.com/AntelopeJS/antelopejs/pull/262))
- **skills:** Repair verify-antelopejs drift and gate formal findings on changed behaviour ([#263](https://github.com/AntelopeJS/antelopejs/pull/263))
- **skills:** Key exports and file-local names by origin in the verify-antelopejs gate ([#267](https://github.com/AntelopeJS/antelopejs/pull/267))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))

## v1.18.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.17.1...v1.18.0)

### 🚀 Enhancements

- **skills:** Add the verify-antelopejs verification skill and formal checks ([#243](https://github.com/AntelopeJS/antelopejs/pull/243))
- **config:** Load and watch the project's .env, restart with the edited configuration ([#244](https://github.com/AntelopeJS/antelopejs/pull/244))

### 🩹 Fixes

- **cli:** Route the ./cli facade through the output entry ([#241](https://github.com/AntelopeJS/antelopejs/pull/241))

### 💅 Refactors

- **test:** Make every test assert behaviour and drop coverage filler ([#223](https://github.com/AntelopeJS/antelopejs/pull/223))
- Replace comments with TSDoc, directive reasons, and test names ([#225](https://github.com/AntelopeJS/antelopejs/pull/225))
- Remove type assertions and bring type and lint ceilings to zero ([#235](https://github.com/AntelopeJS/antelopejs/pull/235))
- Enforce module layers with dependency-cruiser ([#238](https://github.com/AntelopeJS/antelopejs/pull/238))
- Split oversize files and retire the ratchet ([#239](https://github.com/AntelopeJS/antelopejs/pull/239))
- **utils:** Decode typeof tags through named type guards ([#254](https://github.com/AntelopeJS/antelopejs/pull/254))
- **config:** Replace self-import test seams and the untyped inly import suppression ([#255](https://github.com/AntelopeJS/antelopejs/pull/255))
- **types:** Derive unknown boundary types from their owners ([#256](https://github.com/AntelopeJS/antelopejs/pull/256))
- Replace type assertions with guards, inference and typed fixtures ([#257](https://github.com/AntelopeJS/antelopejs/pull/257))
- **modules:** Type Node's CommonJS Module internals instead of asserting them ([#258](https://github.com/AntelopeJS/antelopejs/pull/258))

### 📖 Documentation

- **changelog:** Upgrade notes of core 1.17.1 ([#220](https://github.com/AntelopeJS/antelopejs/pull/220))

### 📦 Build

- Adopt the suppression budget from tooling-configs 0.2.7 ([#253](https://github.com/AntelopeJS/antelopejs/pull/253))
- **deps:** Adopt @antelopejs/interface-core 0.3.0 ([#259](https://github.com/AntelopeJS/antelopejs/pull/259))

### 🏡 Chore

- Adopt the guardrail pack from tooling-configs 0.2.0 ([#221](https://github.com/AntelopeJS/antelopejs/pull/221))
- Configure Renovate with the shared preset ([#222](https://github.com/AntelopeJS/antelopejs/pull/222))
- Upgrade the guardrail pack to 0.2.3 ([#242](https://github.com/AntelopeJS/antelopejs/pull/242))

### ✅ Tests

- **skills:** Add eval cases for the antelopejs skills ([#245](https://github.com/AntelopeJS/antelopejs/pull/245))

### ❤️ Contributors

- Antony Rizzitelli ([@Upd4ting](https://github.com/Upd4ting))
- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.17.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.17.0...v1.17.1)

### Upgrade notes

- `Events.ModulesStopping` is now announced only when the project's modules stop (`stopAll()` / `destroyAll()`), no longer when a single module is stopped, reloaded or destroyed at runtime ([#219](https://github.com/AntelopeJS/antelopejs/pull/219)). With `@antelopejs/api`, uninstalling or reloading one module no longer leaves the whole backend answering `503 error.server_starting`; requests to the reloading module's routes can briefly get that module's own error instead.
- No API change. A provider can now declare its config variables as a pure function with `antelopeJs.configVarsFile`, so tools that read the project without starting it (`ajs dms build`, `ajs dms start`) can resolve `${@<module>.<VAR>}` ([#218](https://github.com/AntelopeJS/antelopejs/pull/218)).

### 🩹 Fixes

- **lifecycle:** Announce ModulesStopping only when the project stops ([#219](https://github.com/AntelopeJS/antelopejs/pull/219))

### 📖 Documentation

- **changelog:** Upgrade notes of core 1.17.0 ([#217](https://github.com/AntelopeJS/antelopejs/pull/217))
- **config:** Let a provider declare its config variables as a pure function ([#218](https://github.com/AntelopeJS/antelopejs/pull/218))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.17.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.16.0...v1.17.0)

### Upgrade notes

- Requires `@antelopejs/interface-core` `>=0.2.6 <0.3.0`. The project lifecycle is announced through `Events.ModulesStarted` / `Events.ModulesStopping` of `@antelopejs/interface-core/modules`, no longer through the `antelopejs.modules.started` / `stopping` diagnostics channels ([#216](https://github.com/AntelopeJS/antelopejs/pull/216)).
- `GetResponsibleModule()` follows the call chain: it returns the module whose call is running, and `undefined` outside any module's call, rather than the module whose files the caller lives in ([interface-core#42](https://github.com/AntelopeJS/interface-core/pull/42), [#212](https://github.com/AntelopeJS/antelopejs/pull/212)).
- A module that fails to start emits no `ModulesStarted`: a project served by `@antelopejs/api` 1.4 keeps answering `503`.
- A `start()` that has not settled after 120 s fails the start (with a warning at 10 s).

### 🚀 Enhancements

- **lifecycle:** Announce when modules started and before they stop ([#215](https://github.com/AntelopeJS/antelopejs/pull/215))
- **lifecycle:** Announce the project lifecycle through interface-core events ([#216](https://github.com/AntelopeJS/antelopejs/pull/216))

### 🔥 Performance

- **resolution:** Cache the real folder of interface entries ([#214](https://github.com/AntelopeJS/antelopejs/pull/214))

### 🩹 Fixes

- **resolution:** Evaluate interface packages in an interface context of their own ([#212](https://github.com/AntelopeJS/antelopejs/pull/212))

### 📖 Documentation

- Make framework guides task-based and executable ([#208](https://github.com/AntelopeJS/antelopejs/pull/208))
- **cli:** Correct DMS demo startup instructions ([#210](https://github.com/AntelopeJS/antelopejs/pull/210))
- Clarify learning paths and illustrate real outcomes ([#211](https://github.com/AntelopeJS/antelopejs/pull/211))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Thomas

## v1.16.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.15.2...v1.16.0)

### 🚀 Enhancements

- **skills:** Ship the framework agent skills with the core ([#203](https://github.com/AntelopeJS/antelopejs/pull/203))
- **cli:** Support complete DMS project templates ([#207](https://github.com/AntelopeJS/antelopejs/pull/207))

### 📖 Documentation

- Rewrite the README ([#204](https://github.com/AntelopeJS/antelopejs/pull/204))
- Document the embedded runtime with an AdonisJS guide ([#205](https://github.com/AntelopeJS/antelopejs/pull/205))
- Streamline agent guidance and preserve repository contracts ([#206](https://github.com/AntelopeJS/antelopejs/pull/206))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.15.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.15.1...v1.15.2)

### 🩹 Fixes

- **deps:** Cap @antelopejs/interface-core below the next minor the core does not implement ([#202](https://github.com/AntelopeJS/antelopejs/pull/202))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.15.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.15.0...v1.15.1)

### 🩹 Fixes

- **deps:** Require @antelopejs/interface-core 0.2.2, which keeps classes intact across interface calls ([#201](https://github.com/AntelopeJS/antelopejs/pull/201))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.15.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.14.0...v1.15.0)

### 🚀 Enhancements

- **config:** Edit module declarations in antelope.config.ts without restarting ([#200](https://github.com/AntelopeJS/antelopejs/pull/200))

### 🩹 Fixes

- **runtime:** Retire the running generation when LoadModule replaces a module ([#199](https://github.com/AntelopeJS/antelopejs/pull/199))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.14.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.13.5...v1.14.0)

### 🚀 Enhancements

- **runtime:** Resolve each interface import into its provider's instance ([#196](https://github.com/AntelopeJS/antelopejs/pull/196))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.13.5

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.13.4...v1.13.5)

### 🩹 Fixes

- **watch:** Do not crash on files that disappear during the initial scan ([#193](https://github.com/AntelopeJS/antelopejs/pull/193))
- **cli:** Show which interface copies conflict without --verbose ([#194](https://github.com/AntelopeJS/antelopejs/pull/194))
- **runtime:** Stop promptly when interrupted during startup ([#195](https://github.com/AntelopeJS/antelopejs/pull/195))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.13.4

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.13.3...v1.13.4)

### 🩹 Fixes

- **cli:** Accept any environment when the config declares none ([#192](https://github.com/AntelopeJS/antelopejs/pull/192))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.13.3

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.13.2...v1.13.3)

### 🩹 Fixes

- **cli:** Report a failed module creation in project init only once ([#191](https://github.com/AntelopeJS/antelopejs/pull/191))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.13.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.13.1...v1.13.2)

### 🩹 Fixes

- **cli:** Stop project dev cleanly, wrap messages to the terminal and show plugin help ([#190](https://github.com/AntelopeJS/antelopejs/pull/190))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.13.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.13.0...v1.13.1)

### 🩹 Fixes

- **cli:** Make the CLI predictable in scripts and report each problem once ([#189](https://github.com/AntelopeJS/antelopejs/pull/189))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.13.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.12.0...v1.13.0)

### 🚀 Enhancements

- **cli:** Make output ASCII-safe, show details before fixes and expose help helpers ([#188](https://github.com/AntelopeJS/antelopejs/pull/188))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.12.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.11.0...v1.12.0)

### 🚀 Enhancements

- **cli:** Expose the output module as @antelopejs/core/cli ([#186](https://github.com/AntelopeJS/antelopejs/pull/186))
- **cli:** Forward --no-color and --verbose to plugins ([#187](https://github.com/AntelopeJS/antelopejs/pull/187))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.11.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.10.3...v1.11.0)

### 🚀 Enhancements

- **cli:** Add an error boundary and formatted usage errors ([#178](https://github.com/AntelopeJS/antelopejs/pull/178))
- **cli:** Add non-interactive flags and a unified prompt layer ([#181](https://github.com/AntelopeJS/antelopejs/pull/181))

### 🔥 Performance

- **cli:** Make the update check async, cached and quiet ([#172](https://github.com/AntelopeJS/antelopejs/pull/172))
- **cli:** Lazy-load command implementations and heavy modules ([#180](https://github.com/AntelopeJS/antelopejs/pull/180))

### 🩹 Fixes

- **cli:** Write errors, warnings and progress to stderr ([#171](https://github.com/AntelopeJS/antelopejs/pull/171))
- **cli:** Return meaningful exit codes ([#173](https://github.com/AntelopeJS/antelopejs/pull/173))
- **cli:** Validate --env once before doing any work ([#174](https://github.com/AntelopeJS/antelopejs/pull/174))
- **cli:** Pass module init options explicitly to the action ([#175](https://github.com/AntelopeJS/antelopejs/pull/175))
- **logging:** Apply saved formats and persist only real logging changes ([#176](https://github.com/AntelopeJS/antelopejs/pull/176))
- **cli:** Clarify plugin install, update and third-party delegation ([#184](https://github.com/AntelopeJS/antelopejs/pull/184))

### 💅 Refactors

- **cli:** Introduce the output module ([#177](https://github.com/AntelopeJS/antelopejs/pull/177))
- **cli:** Render data commands as tables and add --json ([#179](https://github.com/AntelopeJS/antelopejs/pull/179))
- **cli:** Unify task progress and summaries ([#182](https://github.com/AntelopeJS/antelopejs/pull/182))

### 📖 Documentation

- **cli:** Rewrite help text and align docs with actual output ([#185](https://github.com/AntelopeJS/antelopejs/pull/185))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.10.3

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.10.2...v1.10.3)

### 🩹 Fixes

- **cli:** Disable frozen lockfile explicitly when updating copied lockfiles ([#170](https://github.com/AntelopeJS/antelopejs/pull/170))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.10.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.10.1...v1.10.2)

### 🩹 Fixes

- **logging:** Print an error's cause chain in log lines ([#168](https://github.com/AntelopeJS/antelopejs/pull/168))
- **module:** Leave a destroyed module's context closed on a second destroy ([#169](https://github.com/AntelopeJS/antelopejs/pull/169))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.10.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.10.0...v1.10.1)

### 🩹 Fixes

- **resolution:** Let interface packages own what they register while evaluated ([#162](https://github.com/AntelopeJS/antelopejs/pull/162))
- **logging:** Print the errors an AggregateError carries ([#163](https://github.com/AntelopeJS/antelopejs/pull/163))
- **runtime:** Keep the dev process running when a module fails to reload ([#164](https://github.com/AntelopeJS/antelopejs/pull/164))

### ❤️ Contributors

- Alessandro Aloisio ([@alessaloisio](https://github.com/alessaloisio))

## v1.10.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.9.1...v1.10.0)

### 🚀 Enhancements

- **start:** Refresh the build configuration at start with --refresh-config ([#165](https://github.com/AntelopeJS/antelopejs/pull/165))

### 🏡 Chore

- **playground:** Update antelope dependencies to latest ([#160](https://github.com/AntelopeJS/antelopejs/pull/160))

### 🤖 CI

- **release:** Reference the shared release workflows through v1 ([#158](https://github.com/AntelopeJS/antelopejs/pull/158))
- Stop running the unit suite twice ([#159](https://github.com/AntelopeJS/antelopejs/pull/159))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.9.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.9.0...v1.9.1)

### 🔥 Performance

- **resolution:** Cache realpath lookups and speed up interface call binding ([#156](https://github.com/AntelopeJS/antelopejs/pull/156))

### 📖 Documentation

- Summarise the 1.9.0 prerelease line in the stable entry ([#152](https://github.com/AntelopeJS/antelopejs/pull/152))
- **readme:** Remove social card image ([#153](https://github.com/AntelopeJS/antelopejs/pull/153))

### 🏡 Chore

- Remove .git-blame-ignore-revs ([#154](https://github.com/AntelopeJS/antelopejs/pull/154))

### 🤖 CI

- **release:** Release next from a dedicated branch and restore requireCommits ([#155](https://github.com/AntelopeJS/antelopejs/pull/155))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.9.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.9.0-next.4...v1.9.0)

This release promotes the `1.9.0-next` line to stable. It carries everything published from `v1.9.0-next.0` to `v1.9.0-next.4`, summarised here and listed version by version in the sections below.

### 🚀 Enhancements

- **config:** Module-provided config variables: a module declares the names it publishes under `antelopeJs.configVars`, other modules reference them in their own configuration as `${@module.VAR_NAME}`, and the core resolves the whole graph before anything constructs ([#144](https://github.com/AntelopeJS/antelopejs/pull/144))

### 🩹 Fixes

- **config:** Publish config variables in a provide phase, before construct: staging construction on the variable graph raced the interface graph, which orders the same modules the other way round, and a boot could wait on itself ([#147](https://github.com/AntelopeJS/antelopejs/pull/147))
- **config:** Stop configuration traversal rebuilding values it cannot clone: a `RegExp` in a module config came out as `{}`, which silently turned a regex origin allow-list into an allow-all ([#147](https://github.com/AntelopeJS/antelopejs/pull/147))
- **core:** Fail interface calls into modules that never construct, naming the module that died and the interface, and leave a failed boot with a non-zero exit code instead of a process that lingers ([#148](https://github.com/AntelopeJS/antelopejs/pull/148))
- **core:** Pick the canonical stubbed interface package deterministically, whatever order the modules are declared in ([#145](https://github.com/AntelopeJS/antelopejs/pull/145))
- **resolution:** Load an interface package under its own provider, so a package that hosts its own implementation agrees with its callers whoever imports it first ([#146](https://github.com/AntelopeJS/antelopejs/pull/146))
- **logging:** Stop module attribution from recursing through its own warning, which emitted it dozens of times for a single log line and exhausted the heap ([#150](https://github.com/AntelopeJS/antelopejs/pull/150))

### 🏡 Chore

- **release:** Allow a release with no commits since the last tag ([#151](https://github.com/AntelopeJS/antelopejs/pull/151))

### ✅ Tests

- Stop a shutdown from ending the run before mocha reports it: the unit runner could exit 0 with tests failing, and ten suites went unreported ([#149](https://github.com/AntelopeJS/antelopejs/pull/149))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.9.0-next.4

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.9.0-next.3...v1.9.0-next.4)

### 🩹 Fixes

- **logging:** Stop module attribution from recursing through its own warning ([#150](https://github.com/AntelopeJS/antelopejs/pull/150))

### ✅ Tests

- Stop a shutdown from ending the run before mocha reports it ([#149](https://github.com/AntelopeJS/antelopejs/pull/149))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.9.0-next.3

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.9.0-next.2...v1.9.0-next.3)

### 🩹 Fixes

- **core:** Fail interface calls into modules that never construct ([#148](https://github.com/AntelopeJS/antelopejs/pull/148))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.9.0-next.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.9.0-next.1...v1.9.0-next.2)

### 🩹 Fixes

- **config:** ⚠️  Publish config variables in a provide phase, before construct ([#147](https://github.com/AntelopeJS/antelopejs/pull/147))

#### ⚠️ Breaking Changes

- **config:** ⚠️  Publish config variables in a provide phase, before construct ([#147](https://github.com/AntelopeJS/antelopejs/pull/147))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.9.0-next.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.9.0-next.0...v1.9.0-next.1)

### 🩹 Fixes

- **resolution:** Load an interface package under its own provider ([#146](https://github.com/AntelopeJS/antelopejs/pull/146))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.9.0-next.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.8.1...v1.9.0-next.0)

### 🚀 Enhancements

- **config:** Resolve module-provided config variables before construct ([#144](https://github.com/AntelopeJS/antelopejs/pull/144))

### 🩹 Fixes

- **core:** Pick the canonical stubbed interface package deterministically ([#145](https://github.com/AntelopeJS/antelopejs/pull/145))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.8.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.8.0...v1.8.1)

### 🩹 Fixes

- **cli:** Quote Windows shell invocations instead of relying on shell: true ([#142](https://github.com/AntelopeJS/antelopejs/pull/142))
- **cli:** Resolve the Windows shim before the extension-less bin script ([#141](https://github.com/AntelopeJS/antelopejs/pull/141))

### 🏡 Chore

- Align community files with the organization defaults ([#140](https://github.com/AntelopeJS/antelopejs/pull/140))

### ✅ Tests

- **cli:** Import requiresShell from the module that now exports it ([#143](https://github.com/AntelopeJS/antelopejs/pull/143))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.8.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.7.2...v1.8.0)

### 🚀 Enhancements

- **cli:** Prefer the project-local plugin binary over the global one ([#139](https://github.com/AntelopeJS/antelopejs/pull/139))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.7.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.7.1...v1.7.2)

### 🩹 Fixes

- **cli:** Stop module installs hanging on package-manager prompts and name unresolved interfaces ([#138](https://github.com/AntelopeJS/antelopejs/pull/138))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.7.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.7.0...v1.7.1)

### 🩹 Fixes

- Unblock module installs on peer-heavy packages and stop orphaning module child processes ([#136](https://github.com/AntelopeJS/antelopejs/pull/136))

### 📖 Documentation

- **changelog:** List the 1.7.0 changes since 1.6.0 ([#135](https://github.com/AntelopeJS/antelopejs/pull/135))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.7.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.6.0...v1.7.0)

### 🩹 Fixes

- **runtime:** ⚠️  Re-evaluate nested modules on hot reload and stop treating runtime packages as interfaces ([#126](https://github.com/AntelopeJS/antelopejs/pull/126))
- **resolution:** Stop pinning shared interface facades to one consumer ([#130](https://github.com/AntelopeJS/antelopejs/pull/130))
- **resolution:** Keep a shared facade on its own interface and data intact ([#132](https://github.com/AntelopeJS/antelopejs/pull/132))

### 🏡 Chore

- Migrate CMS test references to DMS ([#124](https://github.com/AntelopeJS/antelopejs/pull/124))
- Roll back the accidental 2.0 release ([#134](https://github.com/AntelopeJS/antelopejs/pull/134))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.6.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.5.1...v1.6.0)

### 🚀 Enhancements

- Publish module lifecycle spans on node:diagnostics_channel ([#120](https://github.com/AntelopeJS/antelopejs/pull/120))
- **cli:** Official plugins, delegation, update and compatibility checks ([#125](https://github.com/AntelopeJS/antelopejs/pull/125))

### 💅 Refactors

- **logging:** Collapse the internal logger into one pipeline ([#121](https://github.com/AntelopeJS/antelopejs/pull/121))

### 📖 Documentation

- Position hexagonal architecture across the ecosystem ([#116](https://github.com/AntelopeJS/antelopejs/pull/116))
- Explain hexagonal architecture across the ecosystem ([#117](https://github.com/AntelopeJS/antelopejs/pull/117))
- Align package description with hexagonal positioning ([#118](https://github.com/AntelopeJS/antelopejs/pull/118))

### 🏡 Chore

- Replace Biome with oxlint, oxfmt and Knip ([#119](https://github.com/AntelopeJS/antelopejs/pull/119))

### 🤖 CI

- Use shared npm release workflow ([#123](https://github.com/AntelopeJS/antelopejs/pull/123))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>
- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.5.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.5.0...v1.5.1)

### 🩹 Fixes

- **test:** Run module tests in provider context ([#114](https://github.com/AntelopeJS/antelopejs/pull/114))
- **ci:** Pass release arguments correctly ([#115](https://github.com/AntelopeJS/antelopejs/pull/115))

### 🤖 CI

- Automate secure npm releases ([#111](https://github.com/AntelopeJS/antelopejs/pull/111))
- Use Node 24 action runtimes ([#112](https://github.com/AntelopeJS/antelopejs/pull/112))
- Authenticate protected release pushes ([#113](https://github.com/AntelopeJS/antelopejs/pull/113))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v1.5.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.11...v1.5.0)

### 🚀 Enhancements

- **embedded:** Run the runtime as a guest of another framework ([#110](https://github.com/AntelopeJS/antelopejs/pull/110))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.4.11

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.10...v1.4.11)

### 🩹 Fixes

- **core:** Preserve provider routing across canonical interfaces ([#109](https://github.com/AntelopeJS/antelopejs/pull/109))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.4.10

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.9...v1.4.10)

### 🩹 Fixes

- **runtime:** Canonicalize interface declarations ([#107](https://github.com/AntelopeJS/antelopejs/pull/107))
- **deps:** Require interface-core 0.0.12 ([#108](https://github.com/AntelopeJS/antelopejs/pull/108))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.4.9

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.8...v1.4.9)

### 🩹 Fixes

- **config:** Canonicalize interface-core config imports ([#106](https://github.com/AntelopeJS/antelopejs/pull/106))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.4.8

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.7...v1.4.8)

### 🔥 Performance

- **cli:** Fast-path project start in production ([#96](https://github.com/AntelopeJS/antelopejs/pull/96))

### 🩹 Fixes

- **core:** Make interface package resolution deterministic ([#97](https://github.com/AntelopeJS/antelopejs/pull/97))
- **runtime:** Coordinate process-global ownership ([#98](https://github.com/AntelopeJS/antelopejs/pull/98))
- **runtime:** Make lifecycle transitions transactional ([#100](https://github.com/AntelopeJS/antelopejs/pull/100))
- **runtime:** Route interface calls to selected providers ([#101](https://github.com/AntelopeJS/antelopejs/pull/101))
- **cli:** Honor declared package manager versions ([#95](https://github.com/AntelopeJS/antelopejs/pull/95))
- **runtime:** Resolve static module package dependencies ([#102](https://github.com/AntelopeJS/antelopejs/pull/102))
- **runtime:** Bind interface imports to selected providers ([#105](https://github.com/AntelopeJS/antelopejs/pull/105))

### 📖 Documentation

- **config:** Use real package names in configuration examples ([1e6f914](https://github.com/AntelopeJS/antelopejs/commit/1e6f914))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.4.7

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.6...v1.4.7)

### 🩹 Fixes

- **core:** Neutralize RegisteringProxy on stubbed optional interfaces and settle async start() before test stub mode ([#94](https://github.com/AntelopeJS/antelopejs/pull/94))

### ❤️ Contributors

- Fabrice Cst <fabrice@altab.be>

## v1.4.6

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.5...v1.4.6)

### 🩹 Fixes

- **runtime:** Provide the core modules interface when launching from a build artifact ([#92](https://github.com/AntelopeJS/antelopejs/pull/92))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.4.5

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.4...v1.4.5)

### 🚀 Enhancements

- **downloaders:** Floating semver ranges, transactional module cache, hardened git updates ([#88](https://github.com/AntelopeJS/antelopejs/pull/88))
- **cli:** Align modules add/install with floating semver ranges ([#90](https://github.com/AntelopeJS/antelopejs/pull/90))

### 📖 Documentation

- Declare table fields with @Field and @Relation decorators in guide examples ([#89](https://github.com/AntelopeJS/antelopejs/pull/89))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>
- Fabrice Cst <fabrice@altab.be>

## v1.4.4

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.3...v1.4.4)

### 🚀 Enhancements

- **cli:** Add reloadCommand and watchDir to generated local modules ([#85](https://github.com/AntelopeJS/antelopejs/pull/85))

### 🩹 Fixes

- **watch:** Adopt runtime-created files and dirs, guard reloads by content signature ([#87](https://github.com/AntelopeJS/antelopejs/pull/87))

### 📖 Documentation

- Add framework documentation ([#86](https://github.com/AntelopeJS/antelopejs/pull/86))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))
- Fabrice Cst <fabrice@altab.be>

## v1.4.3

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.2...v1.4.3)

## v1.4.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.1...v1.4.2)

### 🚀 Enhancements

- **logging:** Default log level to info instead of warn ([#83](https://github.com/AntelopeJS/antelopejs/pull/83))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.4.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.4.0...v1.4.1)

### 🩹 Fixes

- **test:** Register core runtime interface in module test runner ([#82](https://github.com/AntelopeJS/antelopejs/pull/82))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.4.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.3.2...v1.4.0)

### 🚀 Enhancements

- **runtime:** Implement runtime info and dev server registry interface ([#81](https://github.com/AntelopeJS/antelopejs/pull/81))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.3.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.3.1...v1.3.2)

### 🩹 Fixes

- **test:** Validate module graph before constructing modules in test runner ([#80](https://github.com/AntelopeJS/antelopejs/pull/80))

### ❤️ Contributors

- Fabrice Cst <fabrice@altab.be>

## v1.3.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.3.0...v1.3.1)

### 🚀 Enhancements

- **resolution:** Allow interfaces to declare themselves standalone ([#79](https://github.com/AntelopeJS/antelopejs/pull/79))

### 🩹 Fixes

- **shutdown:** Keep graceful shutdown on terminal Ctrl+C in inspector mode ([#78](https://github.com/AntelopeJS/antelopejs/pull/78))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.3.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.2.1...v1.3.0)

### 🚀 Enhancements

- **watch:** Serialize per-module reloads + reloadCommand support ([#74](https://github.com/AntelopeJS/antelopejs/pull/74))

### 🩹 Fixes

- **version-checker:** Surface npm registry failures during startup ([#75](https://github.com/AntelopeJS/antelopejs/pull/75))
- **cli:** Propagate test failures as non-zero exit code ([#76](https://github.com/AntelopeJS/antelopejs/pull/76))
- **test:** Register test directories in internal.moduleByFolder ([#77](https://github.com/AntelopeJS/antelopejs/pull/77))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.2.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.2.0...v1.2.1)

### 🩹 Fixes

- **test:** Run setupTestEnvironment when TestModule is invoked with file filter ([#73](https://github.com/AntelopeJS/antelopejs/pull/73))

### ❤️ Contributors

- Fabrice Cst <fabrice@altab.be>

## v1.2.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.1.6...v1.2.0)

### 🚀 Enhancements

- **resolver:** Allow optional interface deps to stub at runtime ([#72](https://github.com/AntelopeJS/antelopejs/pull/72))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))

## v1.1.6

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.1.5...v1.1.6)

### 🩹 Fixes

- **test:** Set testStubMode after modules are loaded and started ([#71](https://github.com/AntelopeJS/antelopejs/pull/71))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.1.5

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.1.4...v1.1.5)

### 🩹 Fixes

- Declare @antelopejs/interface-core as implemented by the core ([886f921](https://github.com/AntelopeJS/antelopejs/commit/886f921))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.1.4

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.1.3...v1.1.4)

### 🩹 Fixes

- **watch:** Prevent HMR reload loop from atomic-write temp files ([#69](https://github.com/AntelopeJS/antelopejs/pull/69))
- **hmr:** Dedup interface-core and fix proxy registration attribution ([#70](https://github.com/AntelopeJS/antelopejs/pull/70))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.1.3

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.1.2...v1.1.3)

### 🚀 Enhancements

- **watch:** Restart project when config file changes ([#68](https://github.com/AntelopeJS/antelopejs/pull/68))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.1.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.1.1...v1.1.2)

### 🩹 Fixes

- Use source package name instead of config key for outdated module check ([7ff15c1](https://github.com/AntelopeJS/antelopejs/commit/7ff15c1))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.1.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.1.0...v1.1.1)

### 🚀 Enhancements

- Warn about outdated npm modules during dev, run and build ([4e3473c](https://github.com/AntelopeJS/antelopejs/commit/4e3473c))

### 🩹 Fixes

- Catch errors in HMR reload loop to prevent unhandled rejections ([dd6f1a5](https://github.com/AntelopeJS/antelopejs/commit/dd6f1a5))

### 🎨 Styles

- Fix linting formatting ([419bceb](https://github.com/AntelopeJS/antelopejs/commit/419bceb))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.1.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v1.0.0...v1.1.0)

### 🚀 Enhancements

- Serialize config as clean JS instead of JSON ([8f7c85f](https://github.com/AntelopeJS/antelopejs/commit/8f7c85f))
- Add shared interface resolution utility ([ee799d7](https://github.com/AntelopeJS/antelopejs/commit/ee799d7))
- Validate interface dependencies at startup ([6228ce9](https://github.com/AntelopeJS/antelopejs/commit/6228ce9))
- Propose interface selection during module init ([e4f3d3d](https://github.com/AntelopeJS/antelopejs/commit/e4f3d3d))

### 🩹 Fixes

- Display error messages without stack traces in CLI ([06e22df](https://github.com/AntelopeJS/antelopejs/commit/06e22df))

### 💅 Refactors

- Update interface types to match actual manifest schema ([8390086](https://github.com/AntelopeJS/antelopejs/commit/8390086))
- Use shared interface resolution in install command ([c77088f](https://github.com/AntelopeJS/antelopejs/commit/c77088f))

### 🏡 Chore

- Update dependencies and fix type compatibility ([5b7d560](https://github.com/AntelopeJS/antelopejs/commit/5b7d560))

### 🎨 Styles

- Fix linting formatting ([7023d86](https://github.com/AntelopeJS/antelopejs/commit/7023d86))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v1.0.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v0.3.2...v1.0.0)

### 🚀 Enhancements

- Add build and start workflow for production deployment ([#58](https://github.com/AntelopeJS/antelopejs/pull/58))
- Add TypeScript config file support with defineConfig ([#59](https://github.com/AntelopeJS/antelopejs/pull/59))
- Add comprehensive graceful shutdown system ([#62](https://github.com/AntelopeJS/antelopejs/pull/62))
- **test:** Auto-stub unresolved interfaces in test mode ([#66](https://github.com/AntelopeJS/antelopejs/pull/66))

### 🩹 Fixes

- **resolution:** Support scoped module ids in raw resolver ([#61](https://github.com/AntelopeJS/antelopejs/pull/61))
- Clean up remaining dead code and fix install command for npm deps ([a1bd353](https://github.com/AntelopeJS/antelopejs/commit/a1bd353))

### 💅 Refactors

- Global architecture ([#57](https://github.com/AntelopeJS/antelopejs/pull/57))
- Pass full Error objects to logging for stack trace visibility ([#60](https://github.com/AntelopeJS/antelopejs/pull/60))
- Extract test module and add setup config injection ([#63](https://github.com/AntelopeJS/antelopejs/pull/63))
- **test:** Convert inline dynamic imports to top-level and remove typing-only tests ([#64](https://github.com/AntelopeJS/antelopejs/pull/64))
- Clean up HMR pipeline, extract shared install-command utility, remove dead code ([#65](https://github.com/AntelopeJS/antelopejs/pull/65))
- Migrate interfaces to npm packages and remove dead code ([6c9e719](https://github.com/AntelopeJS/antelopejs/commit/6c9e719))

### 🏡 Chore

- Remove skill-creator agent skill ([78caaba](https://github.com/AntelopeJS/antelopejs/commit/78caaba))
- Remove in-repo agent skills/commands and allow TSDoc ([c7924e4](https://github.com/AntelopeJS/antelopejs/commit/c7924e4))
- Migrate from eslint/prettier to biome ([#67](https://github.com/AntelopeJS/antelopejs/pull/67))
- Remove .prettierignore ([0059334](https://github.com/AntelopeJS/antelopejs/commit/0059334))
- Update release-it to ^19.2.4 ([5d949d5](https://github.com/AntelopeJS/antelopejs/commit/5d949d5))

### 🤖 CI

- Simplify workflow triggers to run on all pushes ([03f9ac0](https://github.com/AntelopeJS/antelopejs/commit/03f9ac0))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>

## v0.3.2

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v0.3.1...v0.3.2)

### 🚀 Enhancements

- Support key arrays in config envOverrides ([#55](https://github.com/AntelopeJS/antelopejs/pull/55))

### 🩹 Fixes

- GetResponsibleModule with file root level calls ([5371551](https://github.com/AntelopeJS/antelopejs/commit/5371551))
- Add execute permissions to CLI binary after build ([#53](https://github.com/AntelopeJS/antelopejs/pull/53))
- Aggregate error without output ([#54](https://github.com/AntelopeJS/antelopejs/pull/54))

### 📦 Build

- Replace rm -rf with rimraf ([#52](https://github.com/AntelopeJS/antelopejs/pull/52))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))
- Glastis ([@Glastis](https://github.com/Glastis))
- Thomasims <thomas@antelopejs.com>

## v0.3.1

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v0.3.0...v0.3.1)

### 🩹 Fixes

- Verbose option on project run when using the inspect flag ([#51](https://github.com/AntelopeJS/antelopejs/pull/51))

### 💅 Refactors

- **cli:** Use hard links for package linking ([f06d064](https://github.com/AntelopeJS/antelopejs/commit/f06d064))

### 🏡 Chore

- Changelog ([f2b9eaf](https://github.com/AntelopeJS/antelopejs/commit/f2b9eaf))

### ❤️ Contributors

- Thomas ([@Thomasims](https://github.com/Thomasims))
- Antony Rizzitelli <upd4ting@gmail.com>

## v0.2.0...v0.3.0

[compare changes](https://github.com/AntelopeJS/antelopejs/compare/v0.2.0...v0.3.0)

### 🚀 Enhancements

- Allow testing specific files ([4abe43c](https://github.com/AntelopeJS/antelopejs/commit/4abe43c))
- Add generate script to package.json and enhance ImplementInterface type definitions ([5cdb195](https://github.com/AntelopeJS/antelopejs/commit/5cdb195))
- Improved CLI UX, LIFO spinner, local install, and output modes ([#41](https://github.com/AntelopeJS/antelopejs/pull/41))
- Using changelogen instead of release-it to generate changelog ([#44](https://github.com/AntelopeJS/antelopejs/pull/44))
- **cli:** Create symlinks for interfaces ([b0f0e45](https://github.com/AntelopeJS/antelopejs/commit/b0f0e45))
- REPL ([#46](https://github.com/AntelopeJS/antelopejs/pull/46))
- Reworked channel system ([#47](https://github.com/AntelopeJS/antelopejs/pull/47))
- Warn when using GetResponsibleModule in asynchronous contexts ([#48](https://github.com/AntelopeJS/antelopejs/pull/48))

### 🩹 Fixes

- Cli no longer shows "undefined@version" modules when updating/installing dependencies ([465e105](https://github.com/AntelopeJS/antelopejs/commit/465e105))
- Added sync version of ImplementInterface ([7b1b0ee](https://github.com/AntelopeJS/antelopejs/commit/7b1b0ee))
- **cli:** Move verbose section typing inside logging interface ([1d06508](https://github.com/AntelopeJS/antelopejs/commit/1d06508))
- Don't require implementation function to be async ([ba23759](https://github.com/AntelopeJS/antelopejs/commit/ba23759))
- Modulenames ([#45](https://github.com/AntelopeJS/antelopejs/pull/45))
- Clear channelCache when reloading logging config ([6cb3cc4](https://github.com/AntelopeJS/antelopejs/commit/6cb3cc4))
- Dont attach the same handler multiple times on an event proxy ([2f0194c](https://github.com/AntelopeJS/antelopejs/commit/2f0194c))
- Set error exit code with cli errors ([#49](https://github.com/AntelopeJS/antelopejs/pull/49))
- **watcher:** Check if file still exists ([fe37b8e](https://github.com/AntelopeJS/antelopejs/commit/fe37b8e))
- Attempt at fixing edge cases where the git module source would not update ([#50](https://github.com/AntelopeJS/antelopejs/pull/50))

### 💅 Refactors

- **cli:** Module exports generate ([143b5e3](https://github.com/AntelopeJS/antelopejs/commit/143b5e3))

### 📦 Build

- Command 'build' that remove previous one before building ([#42](https://github.com/AntelopeJS/antelopejs/pull/42))
- Generate output folder ([9c864e3](https://github.com/AntelopeJS/antelopejs/commit/9c864e3))

### 🏡 Chore

- Update pull request template to include interface file generation check ([bb22e01](https://github.com/AntelopeJS/antelopejs/commit/bb22e01))
- **release:** V0.3.0 ([61af6ae](https://github.com/AntelopeJS/antelopejs/commit/61af6ae))

### ❤️ Contributors

- Antony Rizzitelli <upd4ting@gmail.com>
- Thomas ([@Thomasims](https://github.com/Thomasims))
- Thomasims <thomas@antelopejs.com>
- Glastis ([@Glastis](https://github.com/Glastis))
- Fabrice Cst <fabrice@altab.be>

## [0.2.0](https://github.com/AntelopeJS/antelopejs/compare/v0.1.1...v0.2.0) (2025-07-03)

### Features

- **cli:** process interfaces dependencies on `module imports add` ([3df8da4](https://github.com/AntelopeJS/antelopejs/commit/3df8da4eb1681cb84e71f944d27c7ed06c9360fc))
- **imports:** add install command to manage missing interfaces ([#31](https://github.com/AntelopeJS/antelopejs/issues/31)) ([9a8c328](https://github.com/AntelopeJS/antelopejs/commit/9a8c328d7485926f2d68d65f4e6cb1836f75658c))
- setup & cleanup in test project configs ([5db4d34](https://github.com/AntelopeJS/antelopejs/commit/5db4d34800d687c1763bc5fc9b2fd8e1f7aa8a68))
- warn user on outdated ajs ([#36](https://github.com/AntelopeJS/antelopejs/issues/36)) ([b163dde](https://github.com/AntelopeJS/antelopejs/commit/b163dde67b464443c0a270f6fa22211d68db2610))

### Bug Fixes

- **cli:** handle ExitPromptError gracefully in CLI error handling ([#25](https://github.com/AntelopeJS/antelopejs/issues/25)) ([559dd0e](https://github.com/AntelopeJS/antelopejs/commit/559dd0ed72c2fc2405aa2b83a4ed9cd29ba952a9))
- **modules:** add list command to modules CLI ([#26](https://github.com/AntelopeJS/antelopejs/issues/26)) ([592721b](https://github.com/AntelopeJS/antelopejs/commit/592721b0de65bc52a43903d38aa9c6113d110aa1))
- now absolute, relative and paths containing // should work with every command ([#34](https://github.com/AntelopeJS/antelopejs/issues/34)) ([90c9b0a](https://github.com/AntelopeJS/antelopejs/commit/90c9b0a239e40a970a9b75c0aaa1f9acb455b8fb))

### Reverts

- Revert "chore: use skip install for adding imports inside module initialization" ([7bfd954](https://github.com/AntelopeJS/antelopejs/commit/7bfd954cefb5cc41dd8bfcb1de1036e900856b77))

## [0.1.1](https://github.com/AntelopeJS/antelopejs/compare/v0.1.0...v0.1.1) (2025-05-30)

### Bug Fixes

- **loader:** don't git pull if repository set to commit ([e60bea3](https://github.com/AntelopeJS/antelopejs/commit/e60bea30f4db82e38213176a44072d5c216de4cd))
- **loader:** git fetch before checkout when updating git module ([863c890](https://github.com/AntelopeJS/antelopejs/commit/863c8902fcd2bde9d4d416d43a3494f995f2c815))

## [0.1.0](https://github.com/AntelopeJS/antelopejs/compare/v0.0.2...v0.1.0) (2025-05-29)

### Features

- add antelope.module.json file for module configuration and defaultConfig option ([a923f18](https://github.com/AntelopeJS/antelopejs/commit/a923f18d3a8ab960362b59448f1427b95b1977ea))
- add project modules list command ([#23](https://github.com/AntelopeJS/antelopejs/issues/23)) ([340c3e7](https://github.com/AntelopeJS/antelopejs/commit/340c3e7169f2c66432a43ed6da274c6bc5989962))
- add skip install option for module imports ([8e44b31](https://github.com/AntelopeJS/antelopejs/commit/8e44b3188ba8faeee7610858346acd6a95706ccf))
- adding a module from cli now downloads the module's sources and save it to the antelope cache ([#14](https://github.com/AntelopeJS/antelopejs/issues/14)) ([c8000a1](https://github.com/AntelopeJS/antelopejs/commit/c8000a12bf50763da5a0a77fd6a51a9b532e20d3))
- enhance module initialization with interface selection ([#7](https://github.com/AntelopeJS/antelopejs/issues/7)) ([df928d9](https://github.com/AntelopeJS/antelopejs/commit/df928d966ef4b3efb0c77dc0719c07b75202cad8))
- indentation type of config file is kept (tab/space) ([#11](https://github.com/AntelopeJS/antelopejs/issues/11)) ([2d9ea95](https://github.com/AntelopeJS/antelopejs/commit/2d9ea95df39a3b722191313a62303d0658abbd18))
- let source config specify a different entry point ([#16](https://github.com/AntelopeJS/antelopejs/issues/16)) ([fc2b172](https://github.com/AntelopeJS/antelopejs/commit/fc2b172282b01d8107b2c08b8f773646561c4e71))
- loading logging is now on one single refreshing line ([3ca9dca](https://github.com/AntelopeJS/antelopejs/commit/3ca9dcae3a80fa15d9aa583067d1db5cd2b65e8d))
- module init install package command ([57a4bae](https://github.com/AntelopeJS/antelopejs/commit/57a4baed9b5f73295261142f82c8fd2a259ea21a))

### Bug Fixes

- correct spelling of 'optional' in module import options ([a2d4e91](https://github.com/AntelopeJS/antelopejs/commit/a2d4e917e3c6e433d86f88ce2f3785e875dcbbeb))
- execute cmd reject with default to stdout ([aa4ded5](https://github.com/AntelopeJS/antelopejs/commit/aa4ded5c720a6e44693c73749617a6603e608114))
- handle module init errors during project init ([e6f8630](https://github.com/AntelopeJS/antelopejs/commit/e6f86309598f56110c70e9fd0fc29bf6b6366e81))
- inline logging ([#4](https://github.com/AntelopeJS/antelopejs/issues/4)) ([9a9a6b6](https://github.com/AntelopeJS/antelopejs/commit/9a9a6b6e39417dfc9c0b426e9050d1e46cdb241c))
- interface files install without version directory ([#22](https://github.com/AntelopeJS/antelopejs/issues/22)) ([0179148](https://github.com/AntelopeJS/antelopejs/commit/0179148b6333ed7d4097b3002557c9d182afdbc8))
- update output path for TypeScript declarations generation ([#10](https://github.com/AntelopeJS/antelopejs/issues/10)) ([025c5e8](https://github.com/AntelopeJS/antelopejs/commit/025c5e888081a91c9ff48087fef6e76ab3b2d213))
- use local package manager and default to npm ([#9](https://github.com/AntelopeJS/antelopejs/issues/9)) ([3b9c960](https://github.com/AntelopeJS/antelopejs/commit/3b9c960b6e447db31bec12513c37d58e468a911a))

### Performance Improvements

- optimize ajs project modules add/fix commands ([4ecd5fd](https://github.com/AntelopeJS/antelopejs/commit/4ecd5fdbf0daa60b793e3e03c8d155dec5907186))

## [0.0.2](https://github.com/AntelopeJS/antelopejs/compare/v0.0.1...v0.0.2) (2025-05-10)

### Bug Fixes

- add compilation command when adding local module to project ([43ccd79](https://github.com/AntelopeJS/antelopejs/commit/43ccd79348289a82492f5faf912e4537aed8e274))
- allow install template in non-empty directory ([f39feb3](https://github.com/AntelopeJS/antelopejs/commit/f39feb3f6babf9a52def52c2cd06f02d4fb88427))
- optional version in module add ([#1](https://github.com/AntelopeJS/antelopejs/issues/1)) ([3713d00](https://github.com/AntelopeJS/antelopejs/commit/3713d003eac0a549b7542d077a89cbf335570c8b))

## 0.0.1 (2025-05-08)
