---
title: CLI Reference
description: Find the command for creating, running, testing, and building an AntelopeJS project.
navigation: false
---

Run `ajs <command> --help` for the options supported by your installed version. The CLI manages standalone projects; an [embedded host](/docs/concepts/embedded-runtime) manages its modules in code.

| Task | Command | Details |
| --- | --- | --- |
| Create a project | `ajs project init my-app` | [Project commands](/docs/cli/project) |
| Run and reload local modules | `ajs project dev --watch` | [Development mode](/docs/cli/project#ajs-project-dev) |
| Find missing providers | `ajs project modules install` | [Module management](/docs/cli/project) |
| Test a module | `ajs module test` | [Module commands](/docs/cli/module) |
| Build and run an artifact | `ajs project build`, then `ajs project start` | [Project commands](/docs/cli/project) |
| Script the CLI | `--quiet`, `--json` where supported | [Output and exit codes](/docs/cli/introduction#output) |

## Command reference

::card-group
::card{icon="i-ph-terminal" title="Introduction" to="/docs/cli/introduction"}
Overview of the AntelopeJS CLI, installation, command structure, and global options.
::

::card{icon="i-ph-folder-open" title="Project Commands" to="/docs/cli/project"}
Manage projects with init, dev, build, start, module management, and logging configuration.
::

::card{icon="i-ph-puzzle-piece" title="Module Commands" to="/docs/cli/module"}
Scaffold new modules from templates and run module test suites.
::

::card{icon="i-ph-gear" title="Configuration" to="/docs/cli/config"}
View and manage global CLI settings such as the interface repository URL.
::

::card{icon="i-ph-lightning" title="Cheat Sheet" to="/docs/cli/cheat-sheet"}
Quick reference tables for every CLI command, option, and common workflow.
::

::card{icon="i-ph-puzzle-piece" title="Plugin API" to="/docs/cli/plugin-api"}
Build a CLI plugin whose output, errors and exit codes match ajs, with @antelopejs/core/cli.
::
::
