# Architecture

What `@antelopejs/core` is made of, where each piece lives, the flows a change usually crosses, and the invariants the checks hold. Reference only. The user-facing explanation is `docs/1.get-started/4.architecture.md`; the conventions are in [AGENTS.md](AGENTS.md).

## Runtime pieces

| Piece              | What it is                                                                                                                                                 | Where                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Package facade     | The published exports, `launch` by name and as default                                                                                                    | `src/index.ts`, guarded by `src/interface-core-guard.ts`                                                |
| `ajs` CLI          | The bin. `project start` goes to the production path, `dms` and `cloud` to their plugin bins, everything else to the commander tree                       | `src/core/cli/index.ts` (bin), `src/cli/full-cli.ts`, `src/cli/production-start.ts`, `src/cli/plugin.ts` |
| Plugin API         | The `./cli` export for `ajs-<name>` plugins                                                                                                                | `src/core/cli/public.ts`                                                                                |
| Config loader      | Loads `antelope.config.ts` with jiti, then merges the environment, the module shorthand, `antelope.<module>.json`, `envOverrides` and the templates      | `src/core/config/ts-config-file.ts`, `src/core/config/config-loader.ts`, `src/core/config/config-paths.ts` |
| Module loading     | Downloads each declared module (local, local folder, npm package, git) into `.antelope/cache`, under the module locks                                       | `src/core/runtime/module-loading.ts`, `src/core/downloaders/`, `src/core/modules/module-cache.ts`       |
| Interface wiring   | Builds the binding graph and detours Node's resolver so an `@antelopejs/interface-*` import lands on the module bound to it                                | `src/core/resolution/binding-graph.ts`, `src/core/modules/resolver.ts`, `src/core/modules/resolver-detour.ts` |
| Lifecycle          | `provide`, `construct`, `start`, `stop`, `destroy`, `drain`, serialised per module                                                                         | `src/core/modules/module-lifecycle.ts`, `src/core/modules/module-manager.ts`, `src/types/module.types.ts` |
| Launch sequence    | The ordered steps of a boot, interruptible by shutdown, with a policy for what the process claims                                                          | `src/core/runtime/launch-sequence.ts`, `src/core/runtime/runtime-policy.ts`                             |
| Build artifact     | `ajs project build` writes `.antelope/build/build.json`; `ajs project start` boots from it                                                                | `src/core/build/index.ts`, `src/core/repl/project-launch.ts`                                            |
| Module locks       | `antelope-lock/` next to `antelope.config.ts`, one record per `package@version`, in `record`, `frozen`, `replay` or `refresh` mode                        | `src/core/modules/module-locks.ts`, `src/core/downloaders/package-locks.ts`                              |
| Embedded runtime   | `createRuntime()` for a host application that is not an AntelopeJS project                                                                                | `src/core/embedded/runtime.ts`, `src/core/embedded/host-module.ts`                                      |
| Watch and REPL     | Hot reload on source edits, restart on config edits, the interactive session                                                                              | `src/core/runtime/watch/`, `src/core/repl/`, `src/core/repl-session/`                                   |

## Directory map

`.dependency-cruiser.cjs` gives every module a numeric layer. A module imports only modules of a higher number, through their `index.ts` (`index.ts` or `public.ts` for `cli`), and never `src/index.ts`. Lower is higher in the stack.

| Layer | Folder                 | What lives there                                                                                  |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------- |
| 1     | `src/cli/`             | The commands (`commands/project`, `commands/module`, `commands/config`, `update`, `plugins`), each `<cmd>.ts` with a lazy `<cmd>-action.ts`; plugin dispatch; the config writer `common.ts`; locks |
| 1     | `src/core/cli/`        | The bin entry and the public plugin export                                                        |
| 2     | `src/core/embedded/`   | `createRuntime`, the embedded preparer, the host module loaded by path                            |
| 2     | `src/core/test/`       | `TestModule` for `ajs module test`, the stub interface loaded by path                             |
| 2     | `src/core/build/`      | `build()`, the artifact writer, interface range checks                                            |
| 2.5   | `src/core/repl/`       | `launch`, `startProject`, `launchFromBuild`, watch and restart                                    |
| 2.7   | `src/core/repl-session/` | The `--interactive` session                                                                     |
| 3     | `src/core/runtime/`    | The launch sequence, module loading, runtime bootstrap and policy, shutdown, the watchers         |
| 4     | `src/core/downloaders/` | The downloader registry and the local, local-folder, package and git sources                     |
| 4.3   | `src/core/modules/`    | The module manager, module, lifecycle, resolver and detour, cache, cache lock and leases, locks   |
| 4.6   | `src/core/resolution/` | The binding graph, interface resolution and instances, the stub interface runtime                 |
| 5     | `src/core/config/`     | The config loader, the jiti file loader, paths, writes, variables, the project `.env`              |
| 6     | `src/logging/`         | The bridge from the interface-core log listener to the CLI streams                                |
| 6.2   | `src/core/output/`     | UI, `CliError`, exit codes, help, prompts, tasks, symbols                                          |
| 6.4   | `src/core/filesystem/` | `NodeFileSystem`                                                                                  |
| 6.5   | `src/version-ranges/`  | `satisfiesRange`, prerelease-aware                                                                |
| 6.6   | `src/utils/`           | Shared helpers                                                                                    |
| 6.8   | `src/types/`           | `ModuleState`, `ModuleCallbacks` and the other shared types                                       |
| root  | `src/index.ts`, `src/interface-core-guard.ts`, `src/*.d.ts` | The facade, the installed-interface-core range check, type shims     |

Outside `src/`:

- `test/`: the mocha suites (`core/`, `integration/`, `logging/`, `utils/`, `typing/`) and the end-to-end runners (`embedded/`, `package-consumer/`, `cli-smoke/`). `test/setup.ts` loads first. Paths do not mirror `src/`: `src/cli/*` is tested in `test/core/cli/`.
- `playground/`: a real project with its own lockfile, linking the core with `link:..`, run by `playground/test-playground.ts`.
- `skills/`: the agent skills the npm package ships through `antelopeJs.skills` (`antelopejs`, `ajs-cli`, `ajs-consume-interface`, `ajs-author-interface`).
- `.agents/skills/`: the repository's own skills, `verify-antelopejs` and the `formal-*` TLA+ checks; `.claude/skills/*` link to them.
- `docs/`: the source of framework.antelopejs.com.
- `dist/` and `coverage/` are generated. `.antelope/` holds the cache and `build/build.json` at run time.

## Flows

### `ajs project dev` or `run`

1. `src/core/cli/index.ts` hands the command to `src/cli/full-cli.ts`, then `src/cli/commands/project/dev-action.ts`.
2. `launch` (`src/core/repl/launch.ts`) and `startProject(prepareFromConfig)` (`src/core/repl/project-launch.ts`) run `runLaunchSequence` (`src/core/runtime/launch-sequence.ts`).
3. `prepareFromConfig` loads the project through `src/core/config/config-loader.ts`; `createLoaderContext` and `buildModuleConfigs` (`src/core/runtime/module-loading.ts`) download every module through the `DownloaderRegistry` into the `ModuleCache`, recording locks.
4. `ModuleManager.addModules` builds the binding graph (`src/core/resolution/binding-graph.ts`) and sets the resolver bindings.
5. `constructAll` attaches the `ResolverDetour`, runs `provide` then `construct`; `startAll` starts the modules, then the optional ones.
6. With `--watch`, `src/core/runtime/watch/` reloads on source edits and restarts on an edit of `antelope.config.ts` or `.env`, unless the runtime made the write itself.

### Build and start

`ajs project build` (`src/cli/commands/project/build-action.ts`, `src/core/build/index.ts`) loads the config, checks outdated modules and range conflicts, writes `.antelope/build/build.json`, pins it and prunes the cache. `ajs project start` (`src/cli/production-start.ts`, `launchFromBuild` with `prepareFromArtifact`) reads the artifact, claims the module folders through cache leases and runs the same module steps with the locks in `replay` mode. `--refresh-config` evaluates `antelope.config.ts` again against the artifact (`prepareFromRefreshedArtifact`) and exits 3 when the module set no longer matches.

### Config edits

`ajs project modules add|remove|update` and `ajs project logging set` go through `writeConfig` (`src/cli/common.ts`), which rewrites `antelope.config.ts` in place (`src/cli/config-source.ts`). A running dev process restarts on that write unless it made it (`restartUnlessOwnWrite`, `src/core/repl/project-launch.ts`).

## Tests

| Tier               | Where                                             | Run                                                                                                                      |
| ------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Unit and integration | `test/**/*.test.ts` (one mocha glob)            | `pnpm test:unit`; one file: `pnpm exec mocha --require ts-node/register --require test/setup.ts <file> --timeout 30000`    |
| Coverage           | Same suites, serial                               | `pnpm test:coverage` (c8, 90% lines, functions, branches and statements)                                                 |
| End to end         | `test/embedded`, `test/package-consumer`, `test/cli-smoke`, `playground/` | `pnpm test:embedded`, `pnpm test:package-consumer`, `pnpm test:cli-smoke`, `pnpm test:playground`; each builds `dist` first |
| Full               | All of the above but cli-smoke                    | `pnpm test`                                                                                                              |
| Lint and types     | `oxlint.config.ts`, `.dependency-cruiser.cjs`     | `pnpm lint` (oxlint, then `depcruise src test`), `pnpm typecheck` (the root, `test`, `playground` and the skill tsconfigs) |
| Formal             | `.agents/skills/formal-*/`                        | `node .agents/skills/<check>/check.mjs`, needs Java 21                                                                   |

`.github/workflows/ci.yml` calls the shared `ci-node.yml` (`pnpm run checks`, the test job, Windows, `test:cli-smoke` as an extra command) and adds `select`, `verify-map`, the three `formal-*` jobs, `gate`, `renovate-sync` and `verdict`. Locally, scope to what you changed as [verify-antelopejs](.agents/skills/verify-antelopejs/SKILL.md) says: `TERM=xterm-256color`, never `--no-config`.

## Invariants

1. A module imports another module only through its `index.ts` (`<module>-entry-only`), only downward (`<module>-no-upward-imports`), and never `src/index.ts` (`no-importing-package-facade`). `pnpm run deps` fails otherwise. `src/cli` and `src/core/cli` are one module to that config.
2. `src/core/embedded/host-module.ts` and `src/core/test/stub-interface.ts` are loaded by path from `dist` at run time. They look unused and are not; `knip.config.ts` ignores them.
3. The installed `@antelopejs/interface-core` must satisfy the range in `package.json`; `src/interface-core-guard.ts` refuses otherwise, and the range stays capped below the next minor (AGENTS.md, Versioning).
4. Every `test:*` end-to-end script builds `dist` first, and the verify harness fails when `dist` is older than `src/`.
5. Coverage stays at 90% on every axis; `pnpm test` enforces it.
6. `antelope-lock/` is committed by the project that owns `antelope.config.ts`; a `frozen` build fails on a module without a lock.
7. `src/**` has no `any` (`typescript/no-explicit-any` in `oxlint.config.ts`) and `src/cli/commands/**` has no `console` call (`eslint/no-console`); output goes through `src/core/output/`.
8. The formal models cite code by `file.ts:NN`; editing `launch-sequence.ts`, `module-lifecycle.ts` or `cache-lock.ts` means updating the references in `.agents/skills/formal-*` and rerunning their `check.mjs`.
9. A change to a CLI command or to the module and interface model updates the matching `SKILL.md` under `skills/` (AGENTS.md, Shipped files).
