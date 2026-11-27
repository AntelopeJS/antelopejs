---
name: formal-binding-graph
description: Property checks of the interface binding graph over generated module graphs (implements, disabledExports, connections with a source, private instances, cycles), through buildBindingGraph and through a launched project. Use when binding, interface instances, connections or the selected connection change.
---

# Verify interface binding

The checks use fast-check 4.10.2 to drive the real TypeScript implementation, not a separate model. They are bounded, generated testing, not an exhaustive proof over every module graph.

## Run the properties

Use Node 24 from `.nvmrc` and install the pinned lockfile dependencies. From the repository root, run this command.

```sh
TERM=xterm-256color FC_SEED=20261116 pnpm exec mocha --require ts-node/register --require test/setup.ts test/core/resolution/binding-graph.properties.test.ts test/integration/interface-binding.properties.test.ts --exit
```

Expect `3 passing`: the graph property, the unprovided cycle example, and the launched-project property. All of them also run in `pnpm test`.
Change `FC_SEED` to explore another sample. Keep the failing seed and printed counterexample when reporting a failure. The same seed reproduces the same generation and shrinking with the pinned dependency version.

## Judge the result

The graph property builds four modules over four interfaces with `buildBindingGraph`. Interfaces depend on up to two others, so dependency cycles occur. A module implements up to two interfaces and disables a subset of them, uses up to three, sets an export priority, and lists up to two connections for up to two interfaces. A connection names a provider of its interface, or no source when none provides it, as the loader accepts it. For every generated graph:

1. Each import reaches the instance its binding names. The key of an imported interface is `<interface>@<provider>` for a provided binding and `<interface>{...}` for a self-hosted one. A module that implements an interface binds it to itself, a pinned module to its pin, and any other to an enabled provider or to none.
2. A disabled export is private and no other module reaches it: an instance `<interface>@<disabler>` is marked `private`, and another module's key or connection key reaches it only when the graph reports an error.
3. Each connection of a module is keyed by its source, `<interface>@<source>`, an implementer's connection to another provider included; a connection with no source and no id is keyed like the plain import unless the interface sits in a cycle nobody provides.
4. Resolution ends with an instance or an error. A key that is no instance comes with an error. An interface with a private instance has a public one too, unless it reaches a dependency cycle nobody provides, so an undeclared import never reaches a disabled export. A dependency cycle nobody provides is an error, never a stack overflow.

The launched-project property writes three modules that depend on one interface. Each is a consumer, a provider or a provider that disables its export, and each consumer may pin a module. It runs `launch`, and each module reports what its plain import answers and what `GetInterfaceInstances` lists. A project with no provider or with a pin to a module that does not provide the interface must be refused. Otherwise:

5. An implementer's plain import runs its own implementation, a pinned consumer's runs its pin, and any other runs the first provider by module id; no other module ever runs a disabled export.
6. The connections a module lists are its pin, or every provider, and exactly the one its plain import reaches has `selected` true. A module that disables its export has no selected connection.

On failure, read the shrunk project as a fixture and check these facts before calling it a product bug.

- The graph input is one the loader accepts: every connection source provides its interface, and a connection with no source names an interface nobody provides.
- The oracle reads `providersOf` from `implemented` and `disabled` alone, and never from the graph under test.
- The launched fixture declares the interface in each module's dependencies, and a provider lists it under `antelopeJs.implements`.

A malformed fixture or a wrong assumption about what the loader accepts is a generator error. A mismatch after those checks is a finding. Preserve the failing property and counterexample and leave product code unchanged.

## Findings on main

- **Latent, no reachable input.** `buildBindingGraph` reports no error for a connection whose source does not provide its interface when only `connectionKeys` keys it: `bind` adds the pin error to `moduleErrors` after `build` merged them into `errors`, so a connection scoped to such a source keys `<interface>@<source>` in silence. `ModuleManager` refuses such a source first in `validateOverrideSource`, so no project reaches it. The generator keeps the loader's precondition.

## Fails before the fixes

Each fix was removed alone from a scratch copy of the code, then the properties ran. The fixes reach back to the commits named below.

| Fix | What fails |
| --- | --- |
| #489, disabled export keeps its own instance (run on its parent commit) | Property 2: `i0@m2` is not private. |
| #491, an undeclared import of a private interface finds it unprovided (parent commit) | Property 4: every instance of `i0` is private. |
| #492, `selected` from the binding (its `src` diff reversed) | The launched-project property: a module that disables its export, beside a provider and a consumer, reports the wrong connections. |
| #495, a provider-less cycle is an error (its `src` diff reversed) | The cycle example and property 4 fail with `Maximum call stack size exceeded`. |
| #496, an implementer's connection to another provider (its `src` diff reversed) | Property 3 in the graph property, and the launched-project property. |

## Bounds and exclusions

The graph property runs 400 cases with default seed `20261116`. The launched-project property runs 120 cases with the same seed, and checks the refusal of a project before it runs any code. Both fix their seed and run count, so `next` never goes red on a new seed unless `FC_SEED` is set.

The checks do not cover running-module rebinds (`running`), `exportPriority` beyond equal priorities in launched projects, pins carried through providers across several interfaces in launched projects, the diamond error text, optional modules, or interface version ranges (`formal-interface-ranges`).

## Coverage record

Last synchronized product commit is `9ee148828dcaa93ae67e77e34d234e0f48e939f8`.

| File | What the checks exercise |
| --- | --- |
| `src/core/resolution/binding-graph.ts` | `buildBindingGraph`: binding order, keys, connection keys, cycles |
| `src/core/resolution/binding-graph-instances.ts` | `InstanceTable`: private instances, the unprovided default |
| `src/core/resolution/binding-providers.ts` | `ProviderTable`: a disabled export is no provider |
| `src/core/resolution/binding-diagnostics.ts` | the errors a graph reports |
| `src/core/modules/module-manager-bindings.ts` | `buildBindings`, `selectedConnection`, connection validation |
| `src/core/modules/interface-registry.ts` | `setConnections`: the selected entry |
| `test/core/resolution/binding-graph.properties.test.ts` | the graph property, its generators and its oracle |
| `test/integration/interface-binding.properties.test.ts` | the launched-project property |
| `test/helpers/interface-project.ts` | the project fixture |

Compare changes since the sync commit against this table before trusting an old pass. After an intended change to the binding rules, update the oracle, the generators and this record together, and move the sync commit forward only after the properties pass again.
