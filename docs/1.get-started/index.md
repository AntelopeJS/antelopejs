---
title: Get Started
description: Run your first module, understand its contract boundary, or embed AntelopeJS in an existing application.
navigation: false
---

AntelopeJS connects TypeScript modules through explicit interfaces. Start with a running local module, then add the capabilities your application needs.

## Run your first module

1. [Install the CLI](/docs/get-started/installation) and verify Node.js and Git.
2. [Complete the quick start](/docs/get-started/quick-start): observe startup, shutdown and a source reload.
3. [Add an HTTP route](/docs/guides/api-routing) once you have a configured API provider.

## Understand the design

::card-group
::card{icon="i-ph-info" title="Introduction" to="/docs/get-started/introduction"}
Learn about Antelopejs, its philosophy, key features, and how interface-based architecture helps you build better applications.
::

::card{icon="i-ph-download" title="Installation" to="/docs/get-started/installation"}
Install the Antelopejs CLI and set up your development environment.
::

::card{icon="i-ph-play" title="Quick Start" to="/docs/get-started/quick-start"}
Create a local module and verify its lifecycle before adding external services.
::

::card{icon="i-ph-blueprint" title="Architecture" to="/docs/get-started/architecture"}
Understand the core architecture of Antelopejs: interfaces, modules, and the core.
::
::

## Already have a server?

[Embed AntelopeJS in your application](/docs/guides/embedded-runtime) instead of moving process ownership to the CLI. The host starts and stops the runtime and accesses interfaces through `runtime.use()`.
