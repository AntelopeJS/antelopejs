---
title: Concepts
description: Choose the concept you need to design contracts, assemble providers, or operate modules safely.
navigation: false
---

Start with [Architecture](/docs/get-started/architecture) for the overall model. Read these concepts when a design decision needs more detail; you do not need to read every reference before writing a module.

| Your question | Read |
| --- | --- |
| What should another module import? | [Interfaces](/docs/concepts/interfaces) |
| When can I initialize or release a resource? | [Modules](/docs/concepts/modules) |
| Should this capability be a call, event, or registration? | [Proxies](/docs/concepts/proxies) |
| Which provider receives a call? | [Interface bindings](/docs/concepts/configuration#interface-bindings) |
| How do I supply deployment-specific values? | [Configuration](/docs/concepts/configuration) |
| Who owns signals, logs and shutdown? | [Embedded Runtime](/docs/concepts/embedded-runtime) |

## Concept reference

::card-group
::card{icon="i-ph-brackets-curly" title="Interfaces" to="/docs/concepts/interfaces"}
Understand interface contracts and how modules communicate through well-defined boundaries.
::

::card{icon="i-ph-cube" title="Modules" to="/docs/concepts/modules"}
Explore module structure, lifecycle states, and runtime management functions.
::

::card{icon="i-ph-arrows-left-right" title="Proxies" to="/docs/concepts/proxies"}
Learn about AsyncProxy, EventProxy, and RegisteringProxy — the communication backbone of Antelopejs.
::

::card{icon="i-ph-gear" title="Configuration" to="/docs/concepts/configuration"}
Configure your project with antelope.config.ts, module sources, environment overrides, and more.
::

::card{icon="i-ph-list-bullets" title="Logging" to="/docs/concepts/logging"}
Use the built-in logging system with severity levels, custom channels, and configurable output.
::

::card{icon="i-ph-wrench" title="Core Utilities" to="/docs/concepts/core-utilities"}
Discover utility functions for interface declarations, implementations, decorators, and module introspection.
::

::card{icon="i-ph-cpu" title="Runtime" to="/docs/concepts/runtime"}
Inspect the runtime environment and register development servers for discovery by external tooling.
::

::card{icon="i-ph-book-open-text" title="Glossary" to="/docs/concepts/glossary"}
Key terms and definitions used throughout the AntelopeJS documentation.
::

::card{icon="i-ph-pulse" title="Diagnostics" to="/docs/concepts/diagnostics"}
Subscribe to module lifecycle spans on node:diagnostics_channel for tracing and metrics.
::

::card{icon="i-ph-plugs-connected" title="Embedded Runtime" to="/docs/concepts/embedded-runtime"}
Run AntelopeJS modules inside an application that owns the process, and compare it with the standalone mode.
::
::
