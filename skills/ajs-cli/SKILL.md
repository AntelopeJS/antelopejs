---
name: ajs-cli
description: Guides running the `ajs` CLI (projects, modules, config, plugins, update). Use when creating, running, building, testing, or managing modules in an AntelopeJS project, listing or updating CLI plugins, or when the user asks what an `ajs` command does. Everything under `ajs dms` belongs to the dms-frontend skill.
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
ajs project build            # download & install modules, check they load, write .antelope/build/build.json
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
ajs project modules update [modules...]  # bump npm modules to their latest versions (--dry-run)
ajs project modules install              # add a provider module for every unresolved interface (-y: never ask)
```

`add` in package mode accepts `<name>@<exact|range|dist-tag>`; without a spec it writes a caret range of the latest version. `add` does no interface resolution.

`modules install` (not `add`) fixes **unresolved imports**, and despite its name it installs no npm dependencies: it finds the interfaces no loaded module implements, looks up their implementing modules in the interface repository, and writes the chosen one into `antelope.config.ts`. A single implementer is added without a question; with several it asks, or takes the first with `-y`.

Modules declared in `antelope.config.ts` are downloaded into `.antelope/cache` by `dev`, `build`, and `modules add`; a module's own npm dependencies install inside its cache folder.

## Authoring a module

```bash
ajs module init <path>       # scaffold a module from a template (same flags as project init: -t, --interfaces, --pm, -y)
ajs module test [path]       # run the module's tests (-f, --file <path>, repeatable)
```

`ajs module test` reads the module's `antelopeJs.test` entry (e.g. `src/antelope.test.ts`) as a test *config* (`folder`, `setup`, `cleanup`) and runs the test files found there. `init` and `test` are the only `ajs module` subcommands.

A module's `package.json` carries an `antelopeJs` block (it can also live in a dedicated `antelope.module.json`). The interface-relevant fields are `implements` (the interface packages this module *provides*, e.g. `["@antelopejs/interface-database"]`) and `test` (the test entry); the others are `defaultConfig`, `configVars` (config variables the module publishes), `baseUrl`, `paths`, `moduleAliases`, and `skills` (the agent skills it ships, see **antelopejs**). Interfaces a module *consumes* are ordinary `dependencies` (or `optionalDependencies`), not a manifest field; see **ajs-consume-interface**.

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
