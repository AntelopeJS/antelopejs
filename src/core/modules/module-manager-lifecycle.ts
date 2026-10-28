import { ModuleState } from "../../types";
import { clearPathResolutionCache } from "../../utils";
import { clearStubInterfaceWarnings } from "../resolution";
import {
  announceModulesStarted,
  announceModulesStopping,
} from "./lifecycle-signals";
import { Module } from "./module";
import { collectRejectedErrors, unpackErrors } from "./module-errors";
import { evictInterfacePackageCopies } from "./module-manager-cache";
import {
  type ManagedModule,
  type ManagerContext,
  type ModuleOperation,
  type ModuleOperationResults,
} from "./module-manager-context";
import { Logger } from "./module-manager-logger";

const MS_PER_SECOND = 1000;

const START_SLOW_WARNING_MS = 10 * MS_PER_SECOND;

/**
 * `start()` means "ready to serve", and the HTTP gate stays closed until every
 * module has started: one module that never settles would hold the whole
 * project in 503 with nothing in the logs to say why.
 */
const START_TIMEOUT_MS = 120 * MS_PER_SECOND;

/**
 * Starts a module, warning once it is slow and failing it once it is late.
 * The module's own `start` keeps running: its lifecycle queue holds any later
 * transition until it settles.
 */
function startWithinDeadline(module: Module): Promise<void> {
  const timers: NodeJS.Timeout[] = [];
  const deadline = new Promise<never>((_, reject) => {
    timers.push(
      setTimeout(() => {
        Logger.Warn(
          `Module '${module.id}' is still starting after ${START_SLOW_WARNING_MS / MS_PER_SECOND} s`,
        );
      }, START_SLOW_WARNING_MS),
      setTimeout(() => {
        reject(
          new Error(
            `Module '${module.id}' did not start within ${START_TIMEOUT_MS / MS_PER_SECOND} s`,
          ),
        );
      }, START_TIMEOUT_MS),
    );
  });
  return Promise.race([module.start(), deadline]).finally(() => {
    timers.forEach(clearTimeout);
  });
}

export async function runModuleOperations(
  modules: ManagedModule[],
  operation: ModuleOperation,
): Promise<unknown[]> {
  return (await runTrackedModuleOperations(modules, operation)).errors;
}

async function runTrackedModuleOperations(
  modules: ManagedModule[],
  operation: ModuleOperation,
): Promise<ModuleOperationResults> {
  const errors: unknown[] = [];
  const failed: ManagedModule[] = [];
  for (const entry of modules) {
    try {
      await operation(entry.module);
    } catch (error) {
      errors.push(...unpackErrors(error));
      failed.push(entry);
    }
  }
  return { errors, failed };
}

export async function startAll(this: ManagerContext): Promise<void> {
  try {
    await this.startModules([...this.loaded.values()]);
  } catch (error) {
    let cleanupErrors: unknown[] = [];
    try {
      await this.destroyAll();
    } catch (cleanupError) {
      cleanupErrors = unpackErrors(cleanupError);
    }
    throw new AggregateError(
      [...unpackErrors(error), ...cleanupErrors],
      "Failed to start modules",
    );
  }
}

export async function startModules(
  this: ManagerContext,
  modules: ManagedModule[],
): Promise<void> {
  modules.forEach(({ module }) => {
    this.trackModuleStart(module.id);
  });
  const results = await Promise.allSettled(
    modules.map(({ module }) => startWithinDeadline(module)),
  );
  const errors = collectRejectedErrors(results);
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to start modules");
  }
  announceModulesStarted();
}

export async function stopAll(this: ManagerContext): Promise<void> {
  announceModulesStopping();
  const modules = this.getReverseLifecycleModules();
  const errors = await runModuleOperations(modules, (module) => module.stop());
  this.startupOrder = [];
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to stop modules");
  }
}

export async function destroyAll(this: ManagerContext): Promise<void> {
  announceModulesStopping();
  const modules = this.getReverseLifecycleModules();
  const results = await runTrackedModuleOperations(modules, (module) =>
    module.destroy(),
  );
  this.pendingCleanup = results.failed.filter(
    ({ module }) => module.state !== ModuleState.Loaded,
  );
  clearPathResolutionCache();
  for (const id of this.loaded.keys()) {
    this.evictModuleFiles(id, false);
  }
  evictInterfacePackageCopies(this.interfacePackagePlans);
  this.isolation.releaseAll();
  this.resolver.releaseInstances();
  const errors = [...results.errors, ...this.clearManagedState()];
  if (errors.length > 0) {
    throw new AggregateError(errors, "Failed to destroy modules");
  }
}

export function getReverseLifecycleModules(
  this: ManagerContext,
): ManagedModule[] {
  const orderedIds = [...this.startupOrder].reverse();
  const seen = new Set(orderedIds);
  for (const id of [...this.loaded.keys()].reverse()) {
    if (!seen.has(id)) {
      orderedIds.push(id);
    }
  }
  const loadedModules = orderedIds.flatMap((id) => {
    const entry = this.loaded.get(id);
    return entry ? [entry] : [];
  });
  const loadedInstances = new Set(loadedModules.map(({ module }) => module));
  return [
    ...loadedModules,
    ...this.pendingCleanup.filter(({ module }) => !loadedInstances.has(module)),
  ];
}

export function clearManagedState(this: ManagerContext): unknown[] {
  this.loaded.clear();
  this.staticModules.length = 0;
  this.registry.clear();
  this.resolvedAssociations.clear();
  this.resolver.moduleByFolder.clear();
  this.resolver.modulesById.clear();
  this.resolver.interfacePackages.clear();
  this.resolver.interfacePackageEntries.clear();
  this.resolver.interfacePackageResolveFrom.clear();
  this.resolver.lifecycleInterfacePackages.clear();
  this.interfacePackagePlans.clear();
  this.startupOrder = [];
  return this.releaseRuntimeState();
}

export function releaseRuntimeState(this: ManagerContext): unknown[] {
  const errors: unknown[] = [];
  this.configVars.clear();
  this.stubbedInterfacePackages.clear();
  this.resolver.stubbedInterfacePackages.clear();
  clearStubInterfaceWarnings();
  this.moduleTracker.clear();
  this.interfaceRegistry.clear();
  try {
    this.resolverDetour.detach();
  } catch (error) {
    errors.push(error);
  }
  return errors;
}

export function trackModuleStart(this: ManagerContext, moduleId: string): void {
  this.startupOrder = this.startupOrder.filter((id) => id !== moduleId);
  this.startupOrder.push(moduleId);
}
