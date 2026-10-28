<div align="center">
  <img src="./.github/assets/logo.png" alt="AntelopeJS logo" width="88">
  <h1>AntelopeJS</h1>
  <p><strong>Hexagonal architecture, beyond your own code.</strong></p>

<a href="https://www.npmjs.com/package/@antelopejs/core"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/core?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/core?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://framework.antelopejs.com/docs/get-started/introduction"><img alt="Docs" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

</div>

AntelopeJS is a TypeScript framework and CLI for Node.js applications. It extends the ports-and-adapters model from your own code to the modules you install: business modules depend on contracts, provider modules implement them, and the application picks which provider runs.

<p align="center">
  <img src="./.github/assets/contract-model.svg" alt="A business module depends on the database contract; the MongoDB and RethinkDB modules implement it; antelope.config.ts selects MongoDB." width="880">
</p>

## Why AntelopeJS

- **Contracts, not imports.** A module imports interface packages such as [`@antelopejs/interface-database`](https://github.com/AntelopeJS/interface-database), never another module's files.
- **Providers you can swap.** [`@antelopejs/mongodb`](https://github.com/AntelopeJS/mongodb) and [`@antelopejs/rethinkdb`](https://github.com/AntelopeJS/rethinkdb) implement the same database contract; `antelope.config.ts` chooses one, from npm, Git or a local folder.
- **A runtime that wires them.** The core binds every interface to its provider, queues calls until the provider is ready, and runs each module's `construct`, `start`, `stop` and `destroy` steps.
- **Hot reload in development.** `ajs project dev --watch` reloads a changed module without restarting the others.
- **One CLI.** `ajs` creates projects and modules, adds providers, runs tests, and builds and starts the application. It can also run embedded in a host application through `createRuntime`.

A replacement provider leaves consuming code unchanged only when it supports the contract version and behavior that code relies on. Configuration, credentials and data migrations still need your attention.

## Install

AntelopeJS requires Node.js 20.19 or later. Install the CLI globally:

```bash
pnpm add -g @antelopejs/core
```

## Quick start

Create a project with a first module, then run it in development mode:

```bash
ajs project init my-app
cd my-app
ajs project dev --watch
```

Add a provider for an interface your module uses, or let the CLI find one for every unresolved interface:

```bash
ajs project modules add @antelopejs/mongodb
ajs project modules install
```

## Plugins

Official plugins add command groups to `ajs` and ship as separate global packages:

| Command   | Package                                                                  | Purpose                                    |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| `ajs dms` | [`@antelopejs/dms-frontend`](https://github.com/AntelopeJS/dms-frontend) | Develop, build and deploy the DMS frontend |

When a plugin is missing, `ajs` offers to install it with the package manager that installed the CLI. `ajs plugins` lists the official plugins and `ajs update` updates the CLI with every installed plugin.

## Agent skills

`@antelopejs/core` ships the framework's agent skills in `skills/`, declared under `antelopeJs.skills`: `antelopejs` (the mental model and router), `ajs-cli`, `ajs-consume-interface` and `ajs-author-interface`. They follow the core version a project installs. The [AntelopeJS agent skills](https://github.com/AntelopeJS/agent-skills) sync links them, like every package-shipped skill, into a project's `.claude/skills/` and `.agents/skills/`, and the DMS assistant (`@antelopejs/dms-ai`) loads them on its own.

## Documentation

- [Introduction](https://framework.antelopejs.com/docs/get-started/introduction): why the same boundaries matter across your application and its dependencies
- [Quick start](https://framework.antelopejs.com/docs/get-started/quick-start): create and run your first project
- [Architecture](https://framework.antelopejs.com/docs/get-started/architecture): contracts, implementations and application assembly
- [Interfaces](https://framework.antelopejs.com/docs/concepts/interfaces) and [modules](https://framework.antelopejs.com/docs/concepts/modules): define and implement a capability
- [Configuration](https://framework.antelopejs.com/docs/concepts/configuration): select module sources and configure providers
- [CLI cheat sheet](https://framework.antelopejs.com/docs/cli/cheat-sheet): every `ajs` command
- [Interface catalog](https://interfaces.antelopejs.com): the official contracts and their implementations

## Compatibility

| Requirement                                                                  | Version          |
| ---------------------------------------------------------------------------- | ---------------- |
| Node.js                                                                      | `>=20.19`        |
| [`@antelopejs/interface-core`](https://github.com/AntelopeJS/interface-core) | `>=0.3.0 <0.4.0` |

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a pull request. The local checks are:

```bash
pnpm install
pnpm lint
pnpm test
```

## License

[Apache-2.0](./LICENSE)
