# Upgrade notes

Each section is the upgrade-notes block of one release. Paste it into the GitHub release body and under the release's heading in `CHANGELOG.md`. The changelog generator writes only commit subjects, and several of these changes have no `!` in theirs.

## v1.22.0

1.22.0 is a minor release. It raises the `@antelopejs/interface-core` requirement, and that change carries the compile breaks below. Ranges such as `<2` accept it.

### Requirements

- **`@antelopejs/interface-core` `>=0.5.1 <0.6.0`** (was `>=0.4.0 <0.5.0`) ([#458](https://github.com/AntelopeJS/antelopejs/pull/458)).
  - When a package-manager override or resolution forces core's own copy outside that range, core refuses to load with `@antelopejs/core 1.22.0 requires @antelopejs/interface-core >=0.5.1 <0.6.0, but it loads <version>`. Drop the override or raise it to 0.5.1.
  - Raise the interface-core range of your modules and interface packages to `>=0.5.1 <0.6.0`, so they share core's copy.
- interface-core 0.5.1 was published on 2026-11-13. A package manager that enforces a minimum release age, such as pnpm's `minimumReleaseAge`, refuses to install it until that age has passed. Add it to the exclusions or wait.

### Types from interface-core 0.5

- Two type arguments no longer compile: `AsyncProxy<T, R>` fails with TS2707 and `InterfaceFunction<T, R>()` with TS2558. Both take a single type argument, the function type, and read the result type from it: `new AsyncProxy<(id: string) => Promise<User>>()`, `InterfaceFunction<(id: string) => Promise<User>>()` ([#458](https://github.com/AntelopeJS/antelopejs/pull/458)).
- A `test.setup` hook returns `AntelopeTestOverrides`, which is `Partial<AntelopeConfig>` without `test`. A `test` section returned from `setup` no longer compiles. It never took effect: the run kept the loaded `test.setup` and `test.cleanup`.

### No other API change

- The other changes in this release remove lint suppressions and keep every published declaration and behaviour ([#453](https://github.com/AntelopeJS/antelopejs/pull/453), [#454](https://github.com/AntelopeJS/antelopejs/pull/454), [#455](https://github.com/AntelopeJS/antelopejs/pull/455), [#456](https://github.com/AntelopeJS/antelopejs/pull/456)). Two side effects show only in diagnostics:
  - A module whose main exports a lifecycle callback that is not a function still fails when that phase runs, with the same message. Under `--verbose`, the stack now starts in the module loader ([#455](https://github.com/AntelopeJS/antelopejs/pull/455)).
  - The walk that neutralizes interface proxies in module tests no longer recurses. A very deep export graph, 20,000 levels in our probe, now completes instead of overflowing the stack ([#456](https://github.com/AntelopeJS/antelopejs/pull/456)).

## v1.20.0

1.20.0 is a minor release, and it carries the compile breaks below. Ranges such as `<2` accept it.

### Requirements

- **Node.js `^20.19.0 || >=22.12.0`.** `engines.node` was `>=20.19`, which admitted Node 21 and 22.0 to 22.11, where the CLI prompt layer is not guaranteed to load. Those versions are now outside the range, so a package manager warns or refuses on upgrade ([#337](https://github.com/AntelopeJS/antelopejs/pull/337)).
- **`@antelopejs/interface-core` `>=0.4.0 <0.5.0`** (was `>=0.3.0 <0.4.0`). Core 1.20.0 implements interface-core 0.4.0, so 0.4.0 must be on npm before core 1.20.0 ([#356](https://github.com/AntelopeJS/antelopejs/pull/356)).

### Configuration checks at load

- **(a) Every typed project field is checked when `antelope.config.ts` loads.** The fields are `name`, `cacheFolder`, a module's `source`, `importOverrides`, `disabledExports`, `exportPriority` and `optional`, `logging`, `envOverrides` and `test.folder`. A value of the wrong type fails the load with an error naming the field, for example `Configuration field 'name' does not hold a string after templates and environment overrides.` This holds whether the file wrote the value that way, a template resolved it, or an environment override set it ([#367](https://github.com/AntelopeJS/antelopejs/pull/367)).
- **(b) A module entry with neither `source` nor `version` is refused at load** as `modules.<name>.source`. Before, it loaded and failed later with a `TypeError` on `source.type`. Commands that only read the configuration, such as `modules list`, refuse it too ([#367](https://github.com/AntelopeJS/antelopejs/pull/367)).
- **(c) Environment overrides are decoded by the declared type of their field.** A boolean field (`logging.enabled`, `logging.moduleTracking.enabled`, a module's `optional` or `source.ignoreCache`) takes exactly `true` or `false`. A number field (a module's `exportPriority` entries) takes finite numeric text. Any other text fails the load with the field-naming error. Before, the text was stored as is, so `false` turned logging on. Every other field, module `config` included, keeps the override text ([#367](https://github.com/AntelopeJS/antelopejs/pull/367)).
- **(d) A `build.json` whose fields do not hold their declared types reads as a missing build.** Run `ajs project build` again ([#367](https://github.com/AntelopeJS/antelopejs/pull/367)).
- Module `config` is not checked. An own `__proto__` key in an `antelope.<module>.json` now stays an own key of the module config ([#367](https://github.com/AntelopeJS/antelopejs/pull/367)).

### Templates

- A pure `${key}` template takes the JSON-parsed value of the key, so it can turn a typed project field into another type, for example `name` into a number. The loader now refuses that field with the error of (a) instead of loading it. Module `config` is unaffected ([#367](https://github.com/AntelopeJS/antelopejs/pull/367)).

### Embedded runtime: `use()` and `provide()` read an interface map

- `runtime.use<T>("<request>")` no longer compiles (TS2344). Neither does `runtime.use("<request>")` for a request missing from the new `EmbeddedInterfaces` map (TS2345). Runtime behaviour does not change ([#363](https://github.com/AntelopeJS/antelopejs/pull/363)).
- `AntelopeRuntime.provide` takes the package from the same map, and the implementation is typed by it ([#366](https://github.com/AntelopeJS/antelopejs/pull/366)).
- Migration: declare each request once, then call `use()` and `provide()` without a type argument.

  ```ts
  declare module "@antelopejs/core" {
    interface EmbeddedInterfaces {
      "@antelopejs/interface-dms": DmsPages;
    }
  }

  const pages = runtime.use("@antelopejs/interface-dms");
  ```

### Module manifests

- A package whose `package.json` has no `version` now loads. `ModulePackageJson` `name` and `version` are optional, and so are `Module.version`, `ModuleManifest.version` and `BuildModuleEntry.version`. `antelopeJs.defaultConfig` is typed `unknown`. A TypeScript reader that passes one of them where a `string` or a record is required stops compiling ([#360](https://github.com/AntelopeJS/antelopejs/pull/360)).
- When a downloaded module's `package.json` has no `version`, its module lock is keyed by the version that was packed. `modules update` keys it by the configured spec, so an exact spec works and a range spec still fails with the invalid lock key error. 1.19.0 refused such a package in every lock mode ([#372](https://github.com/AntelopeJS/antelopejs/pull/372)).
- A `dependencies` or `optionalDependencies` entry that is not a string is refused at load, for example `dependencies.a must be a string`. npm and pnpm refuse to install such a `package.json` too ([#360](https://github.com/AntelopeJS/antelopejs/pull/360)).

### Other type changes

- `Ui.json`, `writeData` and `DataOutput` from `@antelopejs/core/cli` refuse data that is not JSON at compile time: a function, a symbol, a bigint or a value typed `unknown`. `DataOutput` takes a type argument, which callers that pass object literals or typed values infer ([#366](https://github.com/AntelopeJS/antelopejs/pull/366)).
- `DownloaderRegistry.getLoaderIdentifier` returns `string | undefined`. A custom downloader whose identifier field holds a non-string is now skipped by `modules add` and `modules install`, and an inherited identifier field is no longer read ([#345](https://github.com/AntelopeJS/antelopejs/pull/345)).
