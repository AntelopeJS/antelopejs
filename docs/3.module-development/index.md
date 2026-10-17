---
title: Module Development
description: Build a module, expose its contract, test its behavior, and make it discoverable.
navigation: false
---

Build and verify the module locally before publishing it. A module can consume existing interfaces without declaring an interface of its own.

## From local code to a reusable module

1. **Create and load it.** [Scaffold a module](/docs/module-development/creating-a-module), configure its build command, and observe its lifecycle in a project.
2. **Define its boundary.** [Export an interface](/docs/module-development/exporting-interfaces) only for behavior other modules need to call.
3. **Verify the contract.** [Test through the public interface](/docs/module-development/testing), with explicit providers for external dependencies.
4. **Make it discoverable.** Publish the package, then optionally [add registry metadata](/docs/module-development/interface-registry). The registry does not host code.

## Development reference

::card-group
::card{icon="i-ph-hammer" title="Creating a Module" to="/docs/module-development/creating-a-module"}
Initialize a new module, understand the directory structure, configure the entry point, and register it in your project.
::

::card{icon="i-ph-plugs-connected" title="Exporting Interfaces" to="/docs/module-development/exporting-interfaces"}
Define interface contracts with InterfaceFunction, EventProxy, and RegisteringProxy, then connect them to implementations.
::

::card{icon="i-ph-test-tube" title="Testing" to="/docs/module-development/testing"}
Run module tests, configure the test environment, and write isolated tests against interface contracts.
::

::card{icon="i-ph-archive" title="Interface Registry" to="/docs/module-development/interface-registry"}
Register interfaces and implementations in the official registry to make them discoverable through the CLI.
::
::
