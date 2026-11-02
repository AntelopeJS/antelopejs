---
title: CLI reference
description: Find the command that creates, runs, tests or builds an AntelopeJS project.
mode: reference
navigation: false
---

Run `ajs <command> --help` for the options of your installed version. The CLI manages standalone projects. An [embedded host](/docs/concepts/embedded-runtime) manages its modules in code.

| Task | Command | Details |
| --- | --- | --- |
| Create a project | `ajs project init my-app` | [Project commands](/docs/cli/project) |
| Run and reload local modules | `ajs project dev --watch` | [Development mode](/docs/cli/project#ajs-project-dev) |
| Find missing providers | `ajs project modules install` | [Project module commands](/docs/cli/project-modules) |
| Test a module | `ajs module test` | [Module commands](/docs/cli/module) |
| Build and run an artifact | `ajs project build`, then `ajs project start` | [Project commands](/docs/cli/project) |
| Script the CLI | `--quiet`, and `--json` where supported | [Output and exit codes](/docs/cli/introduction#output) |

## Command reference

::card-group
::card{icon="i-ph-terminal" title="Introduction" to="/docs/cli/introduction"}
Installation, command structure, global options, output, exit codes and plugins.
::

::card{icon="i-ph-folder-open" title="Project commands" to="/docs/cli/project"}
Create, run, build and start projects, and manage their logging settings.
::

::card{icon="i-ph-package" title="Project module commands" to="/docs/cli/project-modules"}
Add, list, update and remove the modules of a project, and pin their dependencies with module locks.
::

::card{icon="i-ph-puzzle-piece" title="Module commands" to="/docs/cli/module"}
Create modules from templates and run their test suites.
::

::card{icon="i-ph-gear" title="Configuration" to="/docs/cli/config"}
Show and change global CLI settings, such as the interface repository URL.
::

::card{icon="i-ph-lightning" title="Cheat sheet" to="/docs/cli/cheat-sheet"}
Tables of every CLI command, option and common workflow.
::

::card{icon="i-ph-puzzle-piece" title="Plugin API" to="/docs/cli/plugin-api"}
Build a CLI plugin whose output, errors and exit codes match `ajs`, with `@antelopejs/core/cli`.
::
::
