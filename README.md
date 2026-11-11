<img data-illustration src="./.github/assets/readme/fw-hero.svg" width="100%" alt="A hexagon labelled your code is surrounded by database, email, auth, payment, storage and queue providers. The database provider changes from mongodb to postgres and the storage provider from local to S3, while your code stays the same. Caption: Hexagonal architecture, beyond your own code.">

<div align="center">
  <h1>AntelopeJS</h1>
  <p><strong>Hexagonal architecture, beyond your own code.</strong></p>

<a href="https://github.com/AntelopeJS/antelopejs"><img data-illustration alt="GitHub stars" src="https://img.shields.io/github/stars/AntelopeJS/antelopejs?style=for-the-badge&labelColor=000000&color=000000&logo=github"></a> <a href="https://www.npmjs.com/package/@antelopejs/core"><img data-illustration alt="npm" src="https://img.shields.io/npm/v/@antelopejs/core?style=for-the-badge&labelColor=000000&color=000000"></a> <a href="./LICENSE"><img data-illustration alt="License" src="https://img.shields.io/npm/l/@antelopejs/core?style=for-the-badge&labelColor=000000&color=000000"></a> <a href="https://discord.gg/g4pFt6eXqu"><img data-illustration alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a> <a href="https://framework.antelopejs.com/docs/get-started/introduction"><img data-illustration alt="Docs" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

[Docs](https://framework.antelopejs.com/docs/get-started/introduction) · [Quick start](#quick-start) · [Discord](https://discord.gg/g4pFt6eXqu)

</div>

AntelopeJS is a TypeScript framework and CLI for Node.js applications. It extends the ports-and-adapters model from your own code to the modules you install: business modules depend on contracts, provider modules implement them, and the application picks which provider runs. The open-source back office [AntelopeJS DMS](https://github.com/AntelopeJS/dms) is built on it.

## Why AntelopeJS

<img data-illustration src="./.github/assets/readme/fw-swap.svg" width="100%" alt="In antelope.config.ts the MongoDB provider is replaced by the PostgreSQL provider, and the source files orders, customers, billing and routes are marked unchanged. Caption: Swap the provider. Keep your code.">

- **Contracts, not imports.** A module imports interface packages such as [`@antelopejs/interface-database`](https://github.com/AntelopeJS/interface-database), never another module's files.
- **Providers you can swap.** [`@antelopejs/postgres`](https://github.com/AntelopeJS/postgres), [`@antelopejs/mongodb`](https://github.com/AntelopeJS/mongodb), and [`@antelopejs/rethinkdb`](https://github.com/AntelopeJS/rethinkdb) implement the same database contract. `antelope.config.ts` chooses one, from npm, Git, or a local folder.
- **A runtime that wires them.** The core binds every interface to its provider, queues calls until the provider is ready, and runs each module's `construct`, `start`, `stop`, and `destroy` steps.
- **Hot reload in development.** `ajs project dev --watch` reloads a changed module without restarting the others.
- **One CLI.** `ajs` creates projects and modules, adds providers, runs tests, and builds and starts the application. A host application can also embed the runtime through `createRuntime`.

A replacement provider leaves consuming code unchanged only when it supports the contract version and behavior that code relies on. You still handle its configuration, credentials, and data migrations.

<img data-illustration alt="Screen recording from the AntelopeJS framework film. In antelope.config.ts the nodemailer provider is replaced by brevo, git diff --stat reports 1 file changed, and the project's source files stay unchanged." src="./.github/assets/swap.gif" width="100%">

## Quick start

<img data-illustration src="./.github/assets/readme/fw-quickstart.svg" width="100%" alt="A terminal creates a project with the AntelopeJS CLI and starts it in development mode with watch. The modules start, and the next step adds a provider. Caption: One CLI. From init to dev.">

Create a project with a first module, then run it in development mode. Inside a project that lists `@antelopejs/core` as a dependency, npx runs that installed copy:

```bash
npx @antelopejs/core project init my-app --template blank-typescript --pm pnpm --no-git-init
cd my-app
npx @antelopejs/core project dev --watch
```

Leave out the flags to choose a template interactively. Templates are named by slug, for example `blank-typescript` and `dms-demo`.

Add a provider for an interface your module uses. `ajs project modules install` adds one for every interface that no module implements yet:

```bash
npx @antelopejs/core project modules add @antelopejs/mongodb
npx @antelopejs/core project modules install
```

<details>
<summary><b>Install the CLI globally</b></summary>

The Node.js versions AntelopeJS supports are the `engines` field of its [`package.json`](./package.json). Run `npm view @antelopejs/core engines` to read them for a published release. There is nothing to install first: the quick start below runs the CLI with `npx`. To get the `ajs` command on your `PATH`, install the CLI globally:

```bash
pnpm add -g @antelopejs/core
```

</details>

## Documentation

- [Introduction](https://framework.antelopejs.com/docs/get-started/introduction): why the same boundaries matter across your application and its dependencies
- [Quick start](https://framework.antelopejs.com/docs/get-started/quick-start): create and run your first project
- [Architecture](https://framework.antelopejs.com/docs/get-started/architecture): contracts, implementations, and application assembly
- [Interfaces](https://framework.antelopejs.com/docs/concepts/interfaces) and [modules](https://framework.antelopejs.com/docs/concepts/modules): define and implement a capability
- [Configuration](https://framework.antelopejs.com/docs/concepts/configuration): select module sources and configure providers
- [CLI cheat sheet](https://framework.antelopejs.com/docs/cli/cheat-sheet): every `ajs` command
- [Interface catalog](https://interfaces.antelopejs.com): the official contracts and their implementations

<details>
<summary><b>Plugins and agent skills</b></summary>

### Plugins

Official plugins add command groups to `ajs` and ship as separate global packages:

| Command   | Package                                                                  | Purpose                                    |
| --------- | ------------------------------------------------------------------------ | ------------------------------------------ |
| `ajs dms` | [`@antelopejs/dms-frontend`](https://github.com/AntelopeJS/dms-frontend) | Develop, build, and deploy the DMS frontend |
| `ajs cloud` | [`@antelopejs/cloud`](https://github.com/AntelopeJS/cloud-sdk) | Deploy and operate AntelopeJS Cloud projects |

When a plugin is missing, `ajs` offers to install it with the package manager that installed the CLI. `ajs plugins` lists the official plugins. `ajs update` updates the CLI and every official plugin installed globally.

### Agent skills

`@antelopejs/core` ships the framework's agent skills in `skills/`, declared under `antelopeJs.skills`: `antelopejs` (the mental model and router), `ajs-cli`, `ajs-consume-interface`, and `ajs-author-interface`. Each project gets the skills of the core version it installs. The [AntelopeJS agent skills](https://github.com/AntelopeJS/agent-skills) sync links them into a project's `.claude/skills/` and `.agents/skills/`, as it does for every skill a package ships. The DMS assistant (`@antelopejs/dms-ai`) loads them on its own.

</details>

## Star history

<a href="https://star-history.com/#AntelopeJS/antelopejs&Date"><img data-illustration alt="AntelopeJS stars over time" src="https://api.star-history.com/svg?repos=antelopejs/antelopejs&type=Date" width="100%"></a>

If AntelopeJS saves you work, a ⭐ helps other developers find it.

## Compatibility

<!-- antelopejs-docs-compat:start -->

| Package                      | Supported        | Tested with |
| ---------------------------- | ---------------- | ----------- |
| `@antelopejs/interface-core` | `>=0.4.0 <0.5.0` | `0.4.0`     |

<!-- antelopejs-docs-compat:end -->

The `engines` field of [`package.json`](./package.json) holds the supported Node.js range. The contract that `@antelopejs/core` implements is [`@antelopejs/interface-core`](https://github.com/AntelopeJS/interface-core), whose range the table above lists.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you open a pull request. The local checks are:

```bash
pnpm install
pnpm lint
pnpm test
```

## License

[Apache-2.0](./LICENSE)

## Requirements

<!-- antelopejs-docs-node:start -->

This package requires Node.js `^20.19.0 || >=22.12.0`.
<!-- antelopejs-docs-node:end -->
