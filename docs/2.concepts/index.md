---
title: Concepts
description: Find the concept page that answers your question about contracts, providers, configuration, or running modules.
mode: reference
navigation: false
---

[Architecture](/docs/get-started/architecture) describes the overall model. The concept pages add detail for one design decision each. You do not need to read them all before you write a module.

| Your question | Read |
| --- | --- |
| What should another module import? | [Interfaces](/docs/concepts/interfaces) |
| When can I initialize or release a resource? | [Modules](/docs/concepts/modules) |
| Should this capability be a call, an event, or a registration? | [Proxies](/docs/concepts/proxies) |
| Which provider receives a call? | [Interface bindings](/docs/concepts/configuration#interface-bindings) |
| How do I supply deployment-specific values? | [Configuration](/docs/concepts/configuration) |
| Who owns signals, logs, and shutdown? | [Embedded runtime](/docs/concepts/embedded-runtime) |

## Concept reference

### Foundations

::card-group
::card{icon="i-ph-brackets-curly" title="Interfaces" to="/docs/concepts/interfaces"}
Interface contracts, and how modules call each other through them without knowing the provider.
::

::card{icon="i-ph-cube" title="Modules" to="/docs/concepts/modules"}
Module structure, lifecycle states, and the functions that manage modules at run time.
::

::card{icon="i-ph-arrows-left-right" title="Proxies" to="/docs/concepts/proxies"}
`AsyncProxy`, `EventProxy`, and `RegisteringProxy`, which carry every call, event, and registration between AntelopeJS modules.
::

::card{icon="i-ph-gear" title="Configuration" to="/docs/concepts/configuration"}
The `antelope.config.ts` file, module sources, environment overrides, and interface bindings.
::

::card{icon="i-ph-book-open-text" title="Glossary" to="/docs/concepts/glossary"}
Short definitions of AntelopeJS terms, without the API detail.
::
::

### Operations and tooling reference

Logging helps you diagnose an application. The other pages in this group are for custom tooling, instrumentation, or embedding the runtime. You do not need any of them to complete the quick start.

::card-group
::card{icon="i-ph-list-bullets" title="Logging" to="/docs/concepts/logging"}
The built-in logging system, with severity levels, custom channels, and configurable output.
::

::card{icon="i-ph-wrench" title="Core utilities" to="/docs/concepts/core-utilities"}
Utility functions for interface declarations, implementations, decorators, and module introspection.
::

::card{icon="i-ph-cpu" title="Runtime" to="/docs/concepts/runtime"}
Inspect the runtime environment, and register development servers so external tools can find them.
::

::card{icon="i-ph-pulse" title="Diagnostics" to="/docs/concepts/diagnostics"}
Module lifecycle spans on `node:diagnostics_channel` for tracing and metrics, and the project lifecycle events.
::

::card{icon="i-ph-plugs-connected" title="Embedded runtime" to="/docs/concepts/embedded-runtime"}
Run AntelopeJS modules inside an application that owns the process, compared with the standalone mode.
::
::
