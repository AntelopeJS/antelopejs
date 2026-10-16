---
name: ajs-author-interface
description: Guides authoring or versioning an AntelopeJS interface package itself (@antelopejs/interface-*). Use when editing an interface's contract surface, defining a new interface, or deciding whether a change is breaking and which version to bump.
---

# Authoring & versioning interfaces

An interface is a **versioned contract** shipped as `@<scope>/interface-<name>` (`@antelopejs/…` for the official ones). Its public surface IS the contract: the `exports` subpaths plus the `.d.ts` they point to. Changing that surface is changing the contract — treat it with the discipline of a public API.

## Anatomy of an interface package

```
interface-<name>/
  src/index.ts          # barrel (named re-exports in practice; AGENTS.md prefers `export * from`)
  src/<area>.ts         # contract surface, grouped by concern (one subpath each)
  src/antelope.test.ts  # test entry (referenced by package.json `antelopeJs.test`)
  dist/*.d.ts           # built contract — what consumers actually type-check against
  docs/                 # hand-written guides (numbered files or directories)
  skills/               # package-shipped skill(s) synced to consumers (package.json `antelopeJs.skills` + `files`) — update when the contract changes
  package.json          # `exports` (plus `typesVersions` in older packages) define the subpath surface
```

The core tells an interface package from a runtime module by `antelopeJs.implements`: absent or `[]` means interface package (depending on it requires a provider), a list means runtime module. Keep it empty in an interface package.

An interface can also start **embedded** in the module that implements it (`src/interface/`, exported as `<module>/interface`, with the module listing its own package in `implements`). Extract it to a standalone `interface-<name>` package once a second implementation appears.

Each `exports` subpath is an import consumers pin to — add subpaths deliberately, and keep each one cohesive. Inspect any existing interface's shape as a template with the resolver (`/antelopejs:interface <name> [subpath]` runs `show` and `contract` when the antelopejs plugin is installed):

```bash
npx -y github:AntelopeJS/agent-skills interface show <name>
npx -y github:AntelopeJS/agent-skills interface contract <name> [subpath]
```

## Declaring contract members

At the boundary, the contract is built from core primitives (see `contract core`):

- `InterfaceFunction<Signature>()` — a callable the implementing module attaches to and the provider must implement. Its result is always resolved asynchronously (calls queue until a provider attaches), so design these as async/promise-returning — never a signature that implies a synchronous, provider-config-dependent return.
- `EventProxy` / `RegisteringProxy` — event and registration attachment points across the boundary.
- Exported `type`/`interface`/`class` — the data shapes that cross the boundary.

But an interface is **not limited to proxy points** — it can (and often should) ship real consumer-side code built over them: chainable builders, helpers, validation, convenience classes. The `database` interface is mostly `Table`/`Query`/`Datum` classes whose methods assemble work locally and only hit a proxy (`RunQuery`) at execution. The rule that enables clean attach/detach on reload isn't "no code" — it's that **the only things that actually cross to the provider are the proxy points**; everything else runs in the caller. Keep signatures explicit (no anonymous inline types — define named interfaces). Add TSDoc to every public member; that TSDoc is what consumers read via `contract`.

**Interfaces may build on other interfaces.** Importing another `@antelopejs/interface-*` package to compose contracts is expected (e.g. `data-api` builds on `api`, `api-util`, `core`, `database`, and `database-decorators` — as `peerDependencies`). When you do, that dependency's version becomes part of your own compatibility surface — a breaking change there can force a bump here.

## Versioning the contract surface

Versions are git tags (`v<version>`), cut with release-it (`.release-it.json`, changelog via the release-it-changelogen plugin). Classify every change by its effect on existing consumers:

| Change | Effect |
| --- | --- |
| Add a new optional member, new subpath, new event — existing code keeps compiling & behaving | additive |
| Remove/rename a member, change a signature, tighten a type, change runtime semantics of an existing call | **breaking** |
| Doc/comment/internal-only change, no surface delta | none |

Verify the surface delta mechanically before tagging. Read the *current* contract with the resolver, and diff the committed source against the previous tag. Note `dist/` is gitignored — only `src/` is in git, so diff `src/` (where the exported declarations and their TSDoc live), not the built `.d.ts`:

```bash
npx -y github:AntelopeJS/agent-skills interface contract <name> [sub]   # inspect the current surface
git -C <interface-repo> diff <prev-tag> HEAD -- src/                               # what changed since the last release
```

If the diff removes or changes any existing exported declaration, it's a breaking change. When in doubt, it's breaking.

## Shipping breaking changes without breaking consumers

Because consumers pin a version, prefer **additive evolution** over mutation:

- Add the new member alongside the old; deprecate the old with TSDoc `@deprecated` rather than deleting it in the same release.
- Reserve a real removal for a deliberate major release, and note it in `CHANGELOG.md`.
- A provider module must implement the full contract surface of the version it exports — when you add a required member, that's breaking for providers too, not just consumers.

## Building & publishing

Repo-wide coding conventions: see the **antelopejs** skill (and each repo's `AGENTS.md`). Publishing rebuilds via the `prepack` hook, but build locally too (`pnpm build`) so `dist/*.d.ts` — the contract consumers see — stays current for local tooling.
