import type { ConfigVars } from "@antelopejs/interface-core/config";

import { ModuleState } from "../../types";
import {
  buildConfigVarPlan,
  type ConfigVarPlan,
  declaredConfigVars,
} from "../config";
import { neutralizeInterfacePackage } from "../resolution";
import { Module } from "./module";
import { aggregateErrors, collectRejectedErrors } from "./module-errors";
import {
  type ManagedModule,
  type ManagerContext,
  type ProvidePhaseResult,
} from "./module-manager-context";
import { runModuleOperations } from "./module-manager-lifecycle";
import { Logger } from "./module-manager-logger";

export async function constructAll(this: ManagerContext): Promise<void> {
  const leaseAcquired = this.resolverDetour.attach();
  const modules = [...this.loaded.values()];
  let plan: ConfigVarPlan;
  let provided: ProvidePhaseResult;
  try {
    this.logBindingWarnings();
    this.validateInterfacePackages();
    this.applyInterfaceStubs();
    plan = this.planConfigVars(modules);
    provided = await this.runProvidePhase(modules, plan);
  } catch (error) {
    if (leaseAcquired) {
      throw aggregateErrors(
        [error, ...this.releaseRuntimeState()],
        "Failed to construct modules",
      );
    }
    throw error;
  }

  const errors = [
    ...provided.errors,
    ...(await this.constructReadyModules(modules, plan, provided.failed)),
  ];
  if (errors.length === 0) {
    return;
  }

  const cleanupCandidates = modules.filter(
    ({ module }) => module.state !== ModuleState.Loaded,
  );
  const cleanupErrors = await runModuleOperations(
    cleanupCandidates.reverse(),
    (module) => module.destroy(),
  );
  if (leaseAcquired) {
    cleanupErrors.push(...this.releaseRuntimeState());
  }
  throw new AggregateError(
    [...errors, ...cleanupErrors],
    "Failed to construct modules",
  );
}

export async function constructModules(
  this: ManagerContext,
  modules: ManagedModule[],
): Promise<void> {
  const leaseAcquired = this.resolverDetour.attach();
  try {
    this.logBindingWarnings();
    this.validateInterfacePackages();
    this.applyInterfaceStubs();
    await Promise.all(
      modules
        .filter((entry) => declaredConfigVars(entry.module.manifest).length > 0)
        .map((entry) => this.provideEntry(entry)),
    );
    await Promise.all(modules.map((entry) => this.constructEntry(entry)));
  } catch (error) {
    if (leaseAcquired) {
      throw aggregateErrors(
        [error, ...this.releaseRuntimeState()],
        "Failed to construct modules",
      );
    }
    throw error;
  }
}

export async function constructModule(
  this: ManagerContext,
  module: Module,
  config: Parameters<Module["construct"]>[0],
): Promise<void> {
  try {
    await module.construct(config);
  } catch (error) {
    Logger.Error(`Failed to construct module:`);
    Logger.Error(`  - ID: ${module.id}`);
    Logger.Error(`  - Version: ${module.version}`);
    Logger.Error("  - Error:", error);
    throw error;
  }
}

export function planConfigVars(
  this: ManagerContext,
  modules: ManagedModule[],
): ConfigVarPlan {
  return buildConfigVarPlan(
    modules.map(({ module, config }) => ({
      id: module.id,
      declared: declaredConfigVars(module.manifest),
      config: config.config,
    })),
  );
}

export async function runProvidePhase(
  this: ManagerContext,
  modules: ManagedModule[],
  plan: ConfigVarPlan,
): Promise<ProvidePhaseResult> {
  const entries = new Map(modules.map((entry) => [entry.module.id, entry]));
  const errors: unknown[] = [];
  const failed = new Set<string>();

  for (const stage of plan.stages) {
    const runnable = stage.filter((id) => {
      const blocker = this.findFailedProvider(plan, id, failed);
      if (!blocker) {
        return true;
      }
      failed.add(id);
      const message = `Module '${id}' did not provide its config variables: provider '${blocker}' failed.`;
      Logger.Error(message);
      errors.push(new Error(message));
      return false;
    });

    const results = await Promise.allSettled(
      runnable.map((id) => this.provideEntry(entries.get(id)!)),
    );
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failed.add(runnable[index]);
        errors.push(result.reason);
      }
    });
  }

  return { errors, failed };
}

export async function constructReadyModules(
  this: ManagerContext,
  modules: ManagedModule[],
  plan: ConfigVarPlan,
  failed: Set<string>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  const dead = new Set(failed);
  const runnable = modules.filter(({ module }) => {
    if (dead.has(module.id)) {
      return false;
    }
    const blocker = this.findFailedProvider(plan, module.id, failed);
    if (!blocker) {
      return true;
    }
    dead.add(module.id);
    const message = `Module '${module.id}' did not construct: provider '${blocker}' failed.`;
    Logger.Error(message);
    errors.push(new Error(message));
    return false;
  });

  this.rejectCallsIntoDeadModules(dead, dead);
  const results = await Promise.allSettled(
    runnable.map((entry) => this.constructOrDisable(entry, dead)),
  );
  return [...errors, ...collectRejectedErrors(results)];
}

export async function constructOrDisable(
  this: ManagerContext,
  entry: ManagedModule,
  dead: Set<string>,
): Promise<void> {
  try {
    await this.constructEntry(entry);
  } catch (error) {
    dead.add(entry.module.id);
    this.rejectCallsIntoDeadModules(dead, [entry.module.id]);
    throw error;
  }
}

export function rejectCallsIntoDeadModules(
  this: ManagerContext,
  dead: ReadonlySet<string>,
  targets: Iterable<string>,
): void {
  for (const moduleId of targets) {
    const entry = this.getModuleEntry(moduleId);
    if (!entry) {
      continue;
    }
    for (const interfaceName of this.orphanedInterfaces(entry, dead)) {
      this.rejectCallsInto(moduleId, interfaceName);
    }
  }
}

export function orphanedInterfaces(
  this: ManagerContext,
  entry: ManagedModule,
  dead: ReadonlySet<string>,
): string[] {
  return (entry.module.manifest.implements ?? []).filter(
    (interfaceName) =>
      !entry.config.disabledExports?.has(interfaceName) &&
      !this.hasLiveImplementer(interfaceName, dead),
  );
}

export function hasLiveImplementer(
  this: ManagerContext,
  interfaceName: string,
  dead: ReadonlySet<string>,
): boolean {
  return this.getAllManagedModules().some(
    ({ module, config }) =>
      !dead.has(module.id) &&
      (module.manifest.implements ?? []).includes(interfaceName) &&
      !config.disabledExports?.has(interfaceName),
  );
}

export function rejectCallsInto(
  this: ManagerContext,
  moduleId: string,
  interfaceName: string,
): void {
  const entry = this.getModuleEntry(moduleId);
  if (!entry) {
    return;
  }
  let instanceRoot: string | undefined;
  try {
    instanceRoot = this.resolver.loadInstance(`${interfaceName}@${moduleId}`);
  } catch (error) {
    Logger.Trace(
      `Could not load interface '${interfaceName}' to fail calls into '${moduleId}':`,
      error,
    );
    return;
  }
  if (!instanceRoot) {
    return;
  }
  const root = instanceRoot;
  Logger.Debug(
    `Interface '${interfaceName}' lost its provider '${moduleId}'; calls into it now reject.`,
  );
  entry.module.runInContext(() =>
    neutralizeInterfacePackage(
      root,
      interfaceName,
      `has no provider: module '${moduleId}' did not construct`,
    ),
  );
}

export function findFailedProvider(
  this: ManagerContext,
  plan: ConfigVarPlan,
  moduleId: string,
  failed: Set<string>,
): string | undefined {
  return [...(plan.dependencies.get(moduleId) ?? [])].find((provider) =>
    failed.has(provider),
  );
}

export async function provideEntry(
  this: ManagerContext,
  entry: ManagedModule,
): Promise<void> {
  const { module, config } = entry;
  config.config = this.configVars.resolve(module.id, config.config);
  const published = await this.provideModule(module, config.config);
  this.configVars.record(
    module.id,
    declaredConfigVars(module.manifest),
    published,
  );
}

export async function provideModule(
  this: ManagerContext,
  module: Module,
  config: Parameters<Module["provide"]>[0],
): Promise<ConfigVars | void> {
  try {
    return await module.provide(config);
  } catch (error) {
    Logger.Error(`Failed to provide config variables:`);
    Logger.Error(`  - ID: ${module.id}`);
    Logger.Error(`  - Version: ${module.version}`);
    Logger.Error("  - Error:", error);
    throw error;
  }
}

export async function constructEntry(
  this: ManagerContext,
  entry: ManagedModule,
): Promise<void> {
  const { module, config } = entry;
  config.config = this.configVars.resolve(module.id, config.config);
  await this.constructModule(module, config.config);
}
