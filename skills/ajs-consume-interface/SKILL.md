---
name: ajs-consume-interface
description: Guides how an AntelopeJS module wires itself to interfaces - declaring and importing an interface dependency, providing one with ImplementInterface, optional interfaces, and interface imports that fail to resolve. Use for that module-to-interface plumbing. To use one specific interface's API (HTTP routes, auth, database, logs), load that interface's own skill instead.
---

# Consuming & providing interfaces

For the framework mental model, see the **antelopejs** skill. This skill is the consumer/provider workflow.

## Before writing any interface call: resolve the contract

Do not guess method names or signatures — they are versioned and change. Look them up with the resolver (`/antelopejs:interface <name> [subpath]` runs `show` and `contract` when the antelopejs plugin is installed):

```bash
npx -y github:AntelopeJS/agent-skills interface show <name>            # surface + versions
npx -y github:AntelopeJS/agent-skills interface contract <name> [sub]  # full TSDoc'd contract
```

Each `import "@antelopejs/interface-<name>/<sub>"` line in the output is a literal import you can paste.

**Package-shipped skills first, for installed interfaces.** Interface packages may ship their own skill (declared via `antelopeJs.skills`), synced into the project's `.claude/skills/` (`.agents/skills/` in Codex) as `<package-short-name>--<skill>` and loaded by dms-ai. For an interface that is already **installed**, prefer that skill plus the installed package's own `dist/*.d.ts` and `docs/` directory — that is exactly the version the project compiles against. Use the resolver for interfaces **not yet installed**, for discovering what exists (`list`), and for comparing versions (`versions`, `show <name>@<version>`).

**The one hard rule:** a module never imports another module's files — only interfaces. Every cross-module link is an attachment onto an interface proxy point, so the core can detach and reattach it on reload. If you're tempted to `import` something from a sibling module, the thing you need belongs in an interface instead.

## Importing an interface in a module

1. Add the interface package to the module's `dependencies` (`pnpm add @antelopejs/interface-<name>`). Consuming an interface is just depending on its package.
2. Import the symbols and call them, exactly as `contract`/`show` reported. `InterfaceFunction` calls made before a provider attaches are queued by the proxy layer, so no defensive "not ready yet" checks — but for the same reason every such call is **async**: `await` it, never read it as a synchronous value at module-load top level. (`RegisteringProxy.register` is synchronous and also queues; `EventProxy.emit` is synchronous and does *not* queue — an emit before attach reaches nobody.) Queuing assumes a provider *will* attach: a required dependency with no provider fails startup first (see *Resolving unresolved imports*); one that may legitimately lack a provider is an *optional* interface (see *Optional interfaces*).

```ts
import { Table } from "@antelopejs/interface-database/selection";
// ...use the contract exactly as `contract` reported it
```

A consumed interface only *resolves* at runtime if some loaded module in the project provides it — otherwise it's an unresolved import (see below).

## Providing (implementing) an interface

A module that *provides* an interface declares its package name under `antelopeJs.implements` in `package.json` and calls `ImplementInterface`:

```jsonc
// package.json
"antelopeJs": { "implements": ["@antelopejs/interface-database"] }
```

```ts
import { ImplementInterface } from "@antelopejs/interface-core";
import * as DBInterface from "@antelopejs/interface-database";

ImplementInterface(DBInterface, {
  // implement every InterfaceFunction the contract declares — check with `contract`
});
```

The proxy layer attaches the implementation on module load and detaches on unload/hot-reload — implement idempotently and clean up resources in the module's shutdown lifecycle.

## Resolving unresolved imports

An interface in a module's `dependencies` is **required**: if no loaded module provides it, the runtime aborts startup with `Unresolved interface dependencies: …` rather than running in a half-wired state. When `ajs` reports unresolved imports, a module needs an interface that no loaded module provides. Run:

```bash
ajs project modules install    # adds a provider module for every unresolved interface
```

`install` looks up each unresolved interface in the interface repository and adds an implementing module to `antelope.config.ts`: a single implementer is added without a question, several are offered as a choice (`-y` takes the first). (`ajs project modules add <modules...>` only adds modules you name explicitly; it does not resolve imports.) To see candidate providers for an interface:

```bash
npx -y github:AntelopeJS/agent-skills interface implementations <name>
```

## Optional interfaces

To consume an interface that may legitimately have no provider, declare its package under top-level **`optionalDependencies`** in `package.json` instead of `dependencies` (it's the standard npm field, a sibling of `dependencies` — not part of the `antelopeJs` block). Import and call it exactly the same way.

The difference is what happens when nothing provides it. A missing **required** dependency aborts startup; a missing **optional** one lets startup proceed and the core *stubs* the interface:

- **async calls reject** immediately — `await`ing a stubbed method throws `Interface '<name>' has no provider for this async method; the call was rejected. Load a module that implements it to enable this call.` It does **not** queue or hang.
- **registering proxies keep queuing** — `register` calls are retained and replay if a provider is loaded later; **event emits reach nobody** while stubbed. Neither throws.
- a one-time **warning** is logged at startup: `Optional interface '<name>' has no provider; async calls on it will reject, sync usage will no-op.`

**Detecting whether an optional interface is implemented:** `GetInterfaceInstances(interfaceID)` (from `@antelopejs/interface-core`) returns the calling module's connections to the providers of an interface it declares in `dependencies` or `optionalDependencies`, so `GetInterfaceInstances(id).length > 0` is a valid guard. `try/catch` around the first `await` works too: the stub rejects deterministically with the message above and never hangs.

For a declared dependency, a call is either connected, rejected (stubbed optional), or startup-blocked (unprovided required) — with one caveat: startup only validates manifest-level `implements` lists, so a provider that declares an interface but omits one `InterfaceFunction` from its `ImplementInterface` call leaves that particular method's proxy unattached, and an `await` on it queues indefinitely. If a call hangs while the interface is otherwise connected, suspect a partially-implemented provider.

(A related case: an interface package whose own `package.json` sets `antelopeJs.standalone` self-hosts when no module implements it — same stubbing path, but treated as expected, so it's logged at trace level rather than warned. That's a property of the interface package, not of how you depend on it.)

## Wiring & overriding in antelope.config

Modules are declared in `antelope.config.ts` (authored with `defineConfig` from `@antelopejs/interface-core/config`; read the full shape with `contract core config`): `modules: Record<string, string | AntelopeModuleConfig>` — a plain string is a version shorthand, otherwise `source` is one of `package`, `git`, `local`, `local-folder`. Per-module knobs that matter when consuming interfaces:

- `importOverrides` — force a specific source/provider for an interface, either as a list of `{ interface, source, id }` entries or a `{ interface: source }` shorthand map; e.g. to bind a consumer to a particular implementation when several exist.
- `disabledExports` — stop a module from providing an interface it would otherwise export.
- `exportPriority` — `{ "<interface package>": <number> }` on a provider: the highest becomes the default provider of that interface; a negative value keeps it from becoming the default by accident.
- `config` — module-specific configuration passed at load.

When several loaded modules implement the same interface, each consumer is bound to one of them: its own `importOverrides` pin, a pin carried down from a module above it, or the **default provider** (highest `exportPriority` for that interface on the provider's module entry, alphabetical on a tie, with a startup warning naming where one pin would settle it). Two paths that carry different bindings to the same module stop startup with an error naming that module: pin the interface there. Several `importOverrides` entries with an `id` give one module several connections; `GetInterfaceInstance(interfaceID, id).path` is what to `require()` for the copy bound to that connection.

Config values can reference what another module publishes with `${@<module>.<VAR_NAME>}` (the provider lists the names under `antelopeJs.configVars`), e.g. `apiBaseUrl: "${@api.API_PUBLIC_BASE_URL}"`. `envOverrides` maps environment variables onto config paths, and `environments` holds per-`--env` overrides.

## Pinning interface versions

Interfaces are semver-tagged, but there is **no runtime version negotiation**: the core wires consumer to provider purely by interface *package name*. It evaluates the interface package once per provider it is bound to (modules bound the same way share one copy), so the proxies a consumer calls belong to its bound provider; your own npm-resolved copy is what you *typecheck* against, not necessarily what executes. Your `dependencies` range therefore governs the compile-time contract, which is exactly why it should match what the provider actually implements. Check what a project resolves vs. what's available:

```bash
npx -y github:AntelopeJS/agent-skills interface versions <name>
```

A consumer should target a contract version it has actually been checked against; when bumping across a breaking change, re-run `contract` and diff the surface (see **ajs-author-interface** for the compatibility rules that govern those bumps).
