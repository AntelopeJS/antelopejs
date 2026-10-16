---
title: Guides
description: Add an endpoint, persist data, authenticate requests, or integrate AntelopeJS with an existing application.
navigation: false
---

Choose the behavior you need. These guides assume you can [run a local module](/docs/get-started/quick-start); each interface also needs a compatible provider in your application configuration.

## Build an API in stages

1. [Handle an HTTP request](/docs/guides/api-routing) and verify the response.
2. [Persist a record](/docs/guides/database) through a registered schema and model.
3. [Authenticate requests](/docs/guides/authentication), then define authorization separately.
4. [Generate CRUD endpoints](/docs/guides/data-api) when their access model fits your data.

For a combined example, follow the [task API tutorial](/docs/guides/full-stack-tutorial). It demonstrates a shared authenticated task board, not per-user data isolation or a production account system.

## Task guides

::card-group
::card{icon="i-ph-arrows-split" title="API Routing" to="/docs/guides/api-routing"}
Build HTTP APIs with controllers, route decorators, parameter extraction, and structured responses.
::

::card{icon="i-ph-database" title="Database" to="/docs/guides/database"}
Define tables, apply modifiers for hashing and encryption, and perform CRUD operations with data models.
::

::card{icon="i-ph-lock-key" title="Authentication" to="/docs/guides/authentication"}
Sign and validate JWT tokens, protect routes with authentication decorators, and manage server-side cookies.
::

::card{icon="i-ph-plug" title="Data API" to="/docs/guides/data-api"}
Generate automatic CRUD endpoints from database tables with customizable routes and middleware.
::

::card{icon="i-ph-rocket" title="Full-Stack Application" to="/docs/guides/full-stack-tutorial"}
Connect tables, login routes and authenticated shared-task endpoints, with explicit provider setup and verification checkpoints.
::

::card{icon="i-ph-plugs-connected" title="Embed AntelopeJS in an Existing App" to="/docs/guides/embedded-runtime"}
Start an AntelopeJS runtime from your own application, with AdonisJS 6 as a complete example.
::

::card{icon="i-ph-wrench" title="Troubleshooting" to="/docs/guides/troubleshooting"}
Common errors and their solutions when working with AntelopeJS modules and interfaces.
::
::
