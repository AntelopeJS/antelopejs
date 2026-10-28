---
name: antelopejs
description: Gives the AntelopeJS mental model (a tight core and the `ajs` CLI orchestrating modules that talk only through versioned interfaces) and routes to the right skill. Use when working in an AntelopeJS project, module or interface repository (DMS projects included, for installing or syncing their skills), when the user mentions AntelopeJS, or when asking how a module attaches its code to an interface so another module can call it. Not for building DMS admin pages (use dms). Routes to ajs-consume-interface, ajs-author-interface, ajs-cli, the interface contract resolver, and the skills synced from the project's packages.
---

# AntelopeJS

AntelopeJS is a modular Node.js framework. Read this overview first, then jump to the specialized skill for the task.

## The model in one screen

- **Core + CLI (`ajs`)** — a small runtime that loads modules, wires their interfaces together, and manages the dev/build/start lifecycle. Users rarely edit the core; they run it via `ajs` (modules declared in `antelope.config.ts`). It can also run **embedded** as a guest inside a host app that owns the process (`createRuntime` from `@antelopejs/core`, e.g. the AdonisJS DMS template): no `antelope.config.ts`, modules are plain npm dependencies, and host code reaches interfaces through `runtime.use("<interface package>[/subpath]")`, never by importing them.
- **Modules** — independent units of functionality. A module may import **interfaces**, never another module's files. Its *only* links to the rest of the project are the interface proxy points it attaches to — nothing else crosses the boundary.
- **Interfaces** — **versioned contracts**, usually published as standalone `@<scope>/interface-<name>` packages (a module may also start with an *embedded* interface it exports itself, e.g. `@acme/broker/interface`, and extract it once a second implementation appears). An interface package contains the **proxy points** (`InterfaceFunction`, `EventProxy`, `RegisteringProxy`, …) that actually cross to the provider, the **types** that pass across — and often substantial **client-side code** built over those proxies. It is not just empty slots: the `database` interface is mostly chainable `Table`/`Query`/`Datum` classes that assemble a query *in the caller's process*, crossing the boundary only when `.run()` invokes the underlying `RunQuery` proxy. The contract is the package's whole TypeScript surface (`exports` subpaths + `.d.ts`), versioned with semver git tags. **Interfaces may depend on other interfaces** (e.g. `data-api` builds on `api`, `api-util`, `core`, `database`, and `database-decorators`) — that composition is allowed and normal. What's forbidden is modules reaching into each other.

The golden rule: **the only connections between a module and the rest of the project go through interface proxy points** — never a direct `import` of another module's file. Everything else follows from that.

### How a connection is made — and unmade

Every module-to-module link is built in exactly two steps:

1. **The interface defines proxy points.** `InterfaceFunction`/`EventProxy`/`RegisteringProxy` objects are empty attachment slots — and the *only* things that cross to the provider. (`InterfaceFunction` is a factory over the underlying `AsyncProxy` primitive; all four are exported by `@antelopejs/interface-core`.) The package may wrap them in classes and helpers that run consumer-side (like `Query.run()` calling `RunQuery`), but that code is not the boundary; the proxy is.
2. **The implementing module requires the interface and attaches its implementation onto those proxies** via `ImplementInterface`. Consumers require the same interface and call through the proxies; the proxy queues calls until an implementation is attached.

```ts
// 1. Interface package declares the proxy point (no behavior, just the slot)
export const GetUser = InterfaceFunction<(id: string) => User>();

// 2. Implementing module requires the interface and attaches onto it
import { ImplementInterface } from "@antelopejs/interface-core";
import * as UserInterface from "@antelopejs/interface-user";
ImplementInterface(UserInterface, { GetUser: (id) => db.find(id) });

// Consumer requires the same interface and calls through the proxy
const user = await GetUser("42");   // queued until an implementation attaches
```

Because every connection lives on a known proxy and nothing else crosses the boundary, the core can **detach and reattach a module's links freely** — that's exactly what makes a module safe to hot-reload (or unload) at runtime: tear down its proxy attachments, swap the code, reattach. A direct module-to-module `import` would be an invisible, non-detachable link and would break this — which is why it's forbidden.

**Caveat — what queues, and what's async.** The three proxy kinds behave differently before a provider attaches:

- `InterfaceFunction`/`AsyncProxy` calls **queue** and always return a Promise — nothing that returns a *value* from the provider can be synchronous. This rules out an interface function that *both* depends on a provider's state (e.g. its module config) *and* is callable synchronously at consumer load time; anything that needs a live implementation must be `await`ed.
- `RegisteringProxy.register` is a **synchronous** call that queues too: registrations made early are replayed when the provider attaches.
- `EventProxy.emit` is synchronous and does **not** queue — it reaches only the handlers registered at that moment; an emit before attach is simply not seen.

## Where to go next

| Task | Skill |
| --- | --- |
| Build a module / app *on* AntelopeJS, import & call an interface, resolve unresolved imports | **ajs-consume-interface** |
| Define a new interface, add/version a contract, decide a semver bump, ship breaking changes | **ajs-author-interface** |
| Run, build, scaffold, test via the CLI (`ajs project …`, `ajs module …`) | **ajs-cli** |
| Run, build or deploy the DMS frontend (`ajs dms …`), write a frontend module | **dms-frontend** (synced from `@antelopejs/dms-frontend`) |

## Skills shipped by the project's packages

Packages ship their knowledge as skills, declared under `antelopeJs.skills` in their `package.json`;
this skill and the `ajs-*` skills come from `@antelopejs/core` that way. Two mechanisms load them:

- **Coding agents** (Claude Code, Codex): the `antelopejs` plugin, or
  `npx -y github:AntelopeJS/agent-skills sync`, links them as `<package-short-name>--<skill>` into the
  project's `.claude/skills/` or `.agents/skills/`, from the workspace (source checkouts),
  `node_modules`, and `.antelope/cache`. Run `/antelopejs:skills` (anywhere else:
  `npx -y github:AntelopeJS/agent-skills list`) to see which skills are synced and which package
  ships each one.
- **dms-ai** (the DMS assistant) loads the skills of every loaded module, of their dependencies,
  and of the project's own dependencies by itself.

**DMS projects** get the DMS suite this way: `dms` (the DMS router; start there), `dms-project`,
`dms-module`, `dms-pages`, `dms-auth`, `dms-best-practices` from `@antelopejs/dms`, `dms-frontend`
(the `ajs dms` CLI and frontend modules) from `@antelopejs/dms-frontend`, plus one skill per
installed `dms-*` module (e.g. `dms-saas`). For DMS work, invoke `dms` first and follow
its routing. When those skills are missing, the dependencies are not installed yet: run
`pnpm install` (and `ajs project modules install` for modules declared in `antelope.config.ts`),
then `/antelopejs:sync-skills` (anywhere else: `npx -y github:AntelopeJS/agent-skills sync`).

The project is configured in `antelope.config.ts` at its root, written with `defineConfig` from `@antelopejs/interface-core/config` (not from `@antelopejs/core`).

## Interface contract resolver (use this instead of guessing)

Contracts are versioned data, not memorized facts. Never invent an interface's methods — look them up
with the resolver (`/antelopejs:interface <name> [subpath]` runs `show` and `contract` when the antelopejs plugin is installed):

```bash
# List interfaces published on npm (plus any installed locally)
npx -y github:AntelopeJS/agent-skills interface list

# Inspect one: export subpaths, exported symbols, available versions
npx -y github:AntelopeJS/agent-skills interface show database

# Print the full TSDoc'd contract for a subpath (the source of truth)
npx -y github:AntelopeJS/agent-skills interface contract database query

# A specific published version, and the list of available versions
npx -y github:AntelopeJS/agent-skills interface show database@<version>
npx -y github:AntelopeJS/agent-skills interface versions database
```

The resolver reads contracts straight from the published `@antelopejs/interface-*` packages on
**npm** — no local checkout needed; it fetches and caches the package on demand. `<name>` accepts
`core`, `interface-core`, or `@antelopejs/interface-core`, optionally `@<version>` (default: the
`latest` dist-tag). Bare names resolve against the public scope plus any scope discovered from
the current project's dependencies (`@<scope>/interface-*` deps contribute their scope;
`AJS_INTERFACE_SCOPES` adds more). A locally-present copy (the project's `node_modules`,
`.antelope/cache`, or `$AJS_INTERFACES_DIR`) is used as an offline fast-path when available.
Flags: `--remote` (force a fresh npm fetch), `--offline` (local only). `npm` honours `.npmrc`,
so scopes served from private registries resolve too.

It also resolves interfaces exposed as **subpaths of a module package**: an embedded interface
(`<module>/interface`) or a host package exporting `./interfaces/<group>` (older DMS releases did
this). Use the full import path (`… show @acme/broker/interface`) or `<host-short-name>:<group>`;
hosts are discovered from the current project, and `AJS_DMS_PACKAGES` names extras.

When asked anything about a specific interface's API (what methods exist, a signature, which version has X), run `contract`/`show` and answer from the output — do not rely on training data, which goes stale as contracts version.

## Conventions in AntelopeJS repos

These repos enforce (see any repo's `AGENTS.md`): **pnpm only** (never npm/yarn), English-only identifiers, no `switch`/`case` (use maps), no comments — self-documenting code, TSDoc allowed on public APIs — no inline/anonymous types, no magic values, functions ≤ ~40 lines. Index files: `AGENTS.md` prefers `export * from './module'`, though existing barrels mostly use named re-exports — match the file you're in.
