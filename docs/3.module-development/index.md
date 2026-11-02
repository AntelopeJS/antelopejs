---
title: Module development
description: Build a module, expose its contract, test its behavior, and make it discoverable.
mode: explanation
navigation: false
---

Build and test a module locally before you publish it. A module can consume existing interfaces without declaring an interface of its own.

## From local code to a reusable module

1. **Create and load it.** [Scaffold a module](/docs/module-development/creating-a-module), configure its build command, and watch its lifecycle in a project.
2. **Define its boundary.** [Export an interface](/docs/module-development/exporting-interfaces) only for the behavior that other modules need to call.
3. **Check the contract.** [Test through the public interface](/docs/module-development/testing), and load each provider of an external dependency explicitly.
4. **Make it discoverable.** Publish the package. If you want the CLI to find it, [add registry metadata](/docs/module-development/interface-registry). The registry does not host code.

## Development reference

::card-group
::card{icon="i-ph-hammer" title="Creating a module" to="/docs/module-development/creating-a-module"}
Create a module from a template, read its directory structure, configure the entry point, and register it in your project.
::

::card{icon="i-ph-plugs-connected" title="Exporting interfaces" to="/docs/module-development/exporting-interfaces"}
Define interface contracts with InterfaceFunction, EventProxy, and RegisteringProxy, then connect them to implementations.
::

::card{icon="i-ph-test-tube" title="Testing" to="/docs/module-development/testing"}
Run module tests, configure the test environment, and write isolated tests against interface contracts.
::

::card{icon="i-ph-archive" title="Interface registry" to="/docs/module-development/interface-registry"}
List interfaces and implementations in the interface registry so the CLI can find them.
::
::
