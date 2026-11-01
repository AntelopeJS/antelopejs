---
name: ajs-cli
description: Guides running the `ajs` CLI (projects, modules, config, plugins, update). Use when creating, running, building, testing, or managing modules in an AntelopeJS project, listing or updating CLI plugins, when the user asks what an `ajs` command does, or when starting AntelopeJS inside an existing Node.js server (AdonisJS, Express, Fastify) with `createRuntime`, where `ajs project` does not apply. Everything under `ajs dms` belongs to the dms-frontend skill.
---

# The `ajs` CLI

`ajs` is the entry point to the AntelopeJS core (the global `@antelopejs/core` package). Command groups: `project`, `module`, `config`, plus `update` and `plugins`. Run any command with `--help` for current flags and examples; this skill covers the workflows. **Always pnpm**, never npm/yarn, in these projects.

## Projects

```bash
ajs project init <path>      # new project: antelope.config.ts + a first module (imported or from a template)
ajs project dev              # download/install modules, load & connect them, run (former name: ajs project run)
ajs project dev --watch      # reload modules when their files change (-w)
ajs project dev -e production    # select an environment of antelope.config.ts (env: ANTELOPEJS_LAUNCH_ENV)
ajs project dev -i           # REPL with the project loaded
ajs project dev --inspect    # Node inspector (default 127.0.0.1:9229)
ajs project build            # download & install modules, check they load and interface ranges, write .antelope/build/build.json (--frozen-modules in CI)
ajs project start            # launch from the build artifact; --refresh-config re-resolves the config at start
ajs project logging show|set # view/change logging settings
```

`dev` resolves and wires the module graph every run; `start` trusts a prior `build`. Use `build` + `start` in production/CI, `dev --watch` while developing. `dev` and `start` accept `-c, --concurrency <number>`. `start --refresh-config` exits with code `3` when the configured module set differs from the build: rebuild then.

`init` asks its questions interactively; in scripts and CI answer them with flags (`--name`, `-t/--template`, `--interfaces a,b`, `--pm pnpm`, `--git-init`/`--no-git-init`) or accept defaults with `-y`. Without a terminal, an unanswered question exits with code `2` before anything is written.

## Modules in a project

```bash
ajs project modules list                 # configured modules + their sources (alias: ls; -j for JSON)
ajs project modules add <modules...>     # add & download modules you name (-m, --mode package|git|local|dir; default package = npm)
ajs project modules remove <modules...>  # remove from config (alias: rm; -f, --force)
ajs project modules update [modules...]  # bump npm modules to their latest versions and resolve their locks again (--dry-run)
ajs project modules install              # add a provider module for every unresolved interface (-y: never ask)
```

`add` in package mode accepts `<name>@<exact|range|dist-tag>`; without a spec it writes a caret range of the latest version. `add` does no interface resolution.

`modules install` (not `add`) fixes **unresolved imports**, and despite its name it installs no npm dependencies: it finds the interfaces no loaded module implements, looks up their implementing modules in the interface repository, and writes the chosen one into `antelope.config.ts`. A single implementer is added without a question; with several it asks, or takes the first with `-y`. It then checks interface ranges like `build`.

`build` and `modules install` fail (exit `1`, no `build.json` written) with `Incompatible interface package resolution` when a module's declared range of an interface package excludes the shared copy, the same error `start` and `dev` raise. Fix it as the error says: update that module, or widen its range to the shared version (`^<version>`) and reinstall, or keep the module that provides the shared copy on a version within the range. Do not skip the build check. A module marked `optional: true` that would conflict only produces a warning, as `start` runs without it.

Modules declared in `antelope.config.ts` are downloaded into `.antelope/cache` by `dev`, `build`, and `modules add`; a module's own npm dependencies install inside its cache folder.

**Module locks.** The lockfile an npm module's package manager writes in its cache folder is recorded in `antelope-lock/<package>@<version>/` (`pnpm-lock.yaml`, `package-lock.json` or `yarn.lock`), and replayed on every later install, so the same commit installs the same dependency versions on every machine and every day. Commit `antelope-lock/` with `antelope.config.ts`. A locked range (`^1.0.0`) stays on its recorded version. Only `modules update` resolves the dependencies again (and drops the locks no environment uses, as `modules remove` does): that is how a dependency fix reaches the project, and its diff is the review. In CI and image builds run `ajs project build --frozen-modules` (env `ANTELOPEJS_FROZEN_MODULES`): it installs only from the locks and fails on an npm module without one. Git and local modules carry their own lockfiles and are not locked here.

## Embedded mode: no `ajs project`

In **embedded** mode the host application (AdonisJS, Express, Fastify…) owns the process and starts the runtime itself with `createRuntime({ projectFolder, modules, uses })` from `@antelopejs/core`, calling `start()` and `stop()` from its own lifecycle (in AdonisJS, a service provider). Recognize it before running any `ajs project` command: **no `antelope.config.*`**, and a host file calls `createRuntime`.

- **No `ajs project …`**: `dev`, `build`, `start`, `modules add|remove|install` and `logging` need `antelope.config.ts` and do not apply. `envOverrides` and `environments` do not exist; configure modules in host code.
- **Modules are listed in code**, as keys of the `modules` map (`'@antelopejs/mongodb': { config: { ... } }`). To add one, `pnpm add` it (modules resolve from the host's `node_modules` or a local path, never `.antelope/cache`), add its key to the map, and restart the host.
- **No hot reload**: the runtime forces `dev: false`, so modules apply their production behaviour (e.g. `@antelopejs/api` needs `publicBaseUrl` and listens on its own port). In a DMS app, `ajs dms dev` does not work either: build and start the dashboard (the **dms-project** skill).
- Host code reaches an interface through `runtime.use("<interface package>")`, never a plain `import` of `@antelopejs/interface-*`.
- `ajs module init` and `ajs module test` still work on module folders.

Guide: <https://framework.antelopejs.com/docs/guides/embedded-runtime>.

## Authoring a module

```bash
ajs module init <path>       # scaffold a module from a template (same flags as project init: -t, --interfaces, --pm, -y)
ajs module test [path]       # run the module's tests (-f, --file <path>, repeatable)
```

`ajs module test` reads the module's `antelopeJs.test` entry (e.g. `src/antelope.test.ts`) as a test *config* (`folder`, `setup`, `cleanup`) and runs the test files found there. `init` and `test` are the only `ajs module` subcommands.

A module's `package.json` carries an `antelopeJs` block (it can also live in a dedicated `antelope.module.json`). The interface-relevant fields are `implements` (the interface packages this module *provides*, e.g. `["@antelopejs/interface-database"]`) and `test` (the test entry); the others are `defaultConfig`, `configVars` (config variables the module publishes), `configVarsFile` (the file exporting the pure `configVars(config)` that computes them, for tools reading the project without running it), `baseUrl`, `paths`, `moduleAliases`, and `skills` (the agent skills it ships, see **antelopejs**). Interfaces a module *consumes* are ordinary `dependencies` (or `optionalDependencies`), not a manifest field; see **ajs-consume-interface**.

## Plugins

Official plugins add command groups. Everything under `ajs dms` (the DMS frontend, `@antelopejs/dms-frontend`) belongs to the **dms-frontend** skill that package ships ([docs](https://dms.antelopejs.com/docs/frontend/cli/overview)). A plugin resolves from the nearest `node_modules/.bin` first, then `PATH`; a project that lists it in its dependencies always runs its own version. `ajs plugins` lists them with version, source, and compatibility; `ajs help dms` shows a plugin's help.

## Config

```bash
ajs config show|get|set|reset    # CLI settings; the only key is `git` (the interface repository URL)
```

The interface repository defaults to `https://github.com/AntelopeJS/interfaces.git`; a non-official URL triggers a warning. Override per command with `-g, --git <url>` (env: `ANTELOPEJS_GIT`) on `modules install` and `module init`.

## Common flags and output

Global: `--verbose[=channels]` (TRACE logs, stack traces, full output of failed commands; env `ANTELOPEJS_VERBOSE`), `-q, --quiet` (results, warnings and errors only), `--no-color`. Per command: `-p, --project <path>` (env `ANTELOPEJS_PROJECT`), `-e, --env` (env `ANTELOPEJS_LAUNCH_ENV`), `-j, --json` on the read commands (`modules list`, `logging show`, `config show|get`, `plugins`). Results go to stdout, progress and errors to stderr. Exit codes: `0` ok, `1` failure, `2` usage error, `3` refreshed config differs from the build, `130` cancelled. When a command misbehaves, re-run it with `--verbose` before guessing.

`ajs update` updates a global CLI install and its global plugins (`ajs update dms` for one plugin); plugins installed in a project are updated with pnpm instead.
