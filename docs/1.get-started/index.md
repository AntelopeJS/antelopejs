---
title: Get started
description: Run your first module, understand its contract boundary, or embed AntelopeJS in an existing application.
mode: reference
navigation: false
---

AntelopeJS connects TypeScript modules through explicit interfaces. Start with a running local module, then add the capabilities your application needs.

## Run your first module

1. [Install the CLI](/docs/get-started/installation) and check Node.js and Git.
2. [Complete the quick start](/docs/get-started/quick-start) to see startup, shutdown, and a source reload.
3. [Add an HTTP route](/docs/guides/api-routing) once you have a configured API provider.

## Understand the design

::card-group
::card{icon="i-ph-info" title="Introduction" to="/docs/get-started/introduction"}
Why AntelopeJS applies hexagonal architecture to the modules you install as well as the ones you write.
::

::card{icon="i-ph-download" title="Installation" to="/docs/get-started/installation"}
Install the AntelopeJS CLI and check your development environment.
::

::card{icon="i-ph-play" title="Quick start" to="/docs/get-started/quick-start"}
Create a local module and see its lifecycle before you add external services.
::

::card{icon="i-ph-blueprint" title="Architecture" to="/docs/get-started/architecture"}
How interfaces, modules, and the core fit together in AntelopeJS.
::
::

## Already have a server?

[Embed AntelopeJS in your application](/docs/guides/embedded-runtime) instead of moving process ownership to the CLI. The host starts and stops the runtime and reaches interfaces through `runtime.use()`.
