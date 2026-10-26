import { satisfies, validRange } from "semver";

import {
  createPathWithinMatcher,
  type ResolvedPackage,
  resolvePackage,
  resolvePackageAtRoot,
} from "../../utils";
import {
  type InterfaceRangeConflict,
  InterfaceResolutionError,
  type PreloadedInterfaceCopy,
} from "../output";
import type { UnresolvedInterface } from "../resolution";
import {
  logStubInterfaceWarningOnce,
  neutralizeInterfacePackage,
} from "../resolution";
import { Module } from "./module";
import {
  type InterfacePackageConsumer,
  type InterfacePackagePlan,
  type ManagerContext,
} from "./module-manager-context";
import { Logger } from "./module-manager-logger";

function compareModuleIds(left: string, right: string): number {
  return left.localeCompare(right);
}

export function registerStubbedInterfaces(
  this: ManagerContext,
  stubbed: UnresolvedInterface[],
): void {
  const packageNames = new Set(stubbed.map((entry) => entry.interfacePackage));
  for (const packageName of packageNames) {
    const entries = stubbed.filter(
      (entry) => entry.interfacePackage === packageName,
    );
    this.registerStubbedInterfacePackage(packageName, entries);
  }
  this.buildBindings();
}

export function registerStubbedInterfacePackage(
  this: ManagerContext,
  packageName: string,
  entries: UnresolvedInterface[],
): void {
  const consumers = this.collectInterfacePackageConsumers(packageName);
  const canonicalPackage = [...consumers]
    .sort((left, right) => compareModuleIds(left.moduleId, right.moduleId))
    .find((consumer) => consumer.resolvedPackage)?.resolvedPackage;
  if (!canonicalPackage) {
    return;
  }
  this.stubbedInterfacePackages.set(packageName, canonicalPackage);
  this.interfacePackagePlans.set(packageName, {
    canonicalPackage,
    consumers,
  });
  this.registerInterfacePackage(packageName, canonicalPackage, true);
  logStubInterfaceWarningOnce(
    packageName,
    entries.some((entry) => entry.standalone),
  );
}

export function applyInterfaceStubs(this: ManagerContext): void {
  const implemented = this.collectImplementedInterfaces();
  const stubbed = Array.from(this.stubbedInterfacePackages);
  for (const [interfaceName, resolvedPackage] of stubbed) {
    if (implemented.has(interfaceName)) {
      this.stubbedInterfacePackages.delete(interfaceName);
      this.resolver.stubbedInterfacePackages.delete(interfaceName);
      continue;
    }
    if (!this.resolver.interfacePackages.has(interfaceName)) {
      this.registerInterfacePackage(interfaceName, resolvedPackage, true);
    }
    this.neutralizeInstances(interfaceName);
  }
}

export function neutralizeInstances(
  this: ManagerContext,
  interfaceName: string,
): void {
  for (const instance of this.resolver.instances.keysOf(interfaceName)) {
    let root: string | undefined;
    try {
      root = this.resolver.loadInstance(instance);
    } catch (err) {
      Logger.Error(`Failed to load interface '${instance}':`, err);
      continue;
    }
    if (root) {
      neutralizeInterfacePackage(root, interfaceName);
    }
  }
}

export function collectImplementedInterfaces(
  this: ManagerContext,
): Set<string> {
  const implemented = new Set<string>();
  for (const { module, config } of this.getAllManagedModules()) {
    for (const iface of module.manifest.implements ?? []) {
      if (!config.disabledExports?.has(iface)) {
        implemented.add(iface);
      }
    }
  }
  return implemented;
}

export function resolveInterfacePackagePaths(
  this: ManagerContext,
  interfaceSources: Map<string, Module[]>,
): void {
  for (const [ifacePkg, modules] of interfaceSources) {
    const module = [...modules].sort((left, right) =>
      compareModuleIds(left.id, right.id),
    )[0];
    if (!module) {
      continue;
    }
    const canonicalPackage = this.resolveImplementedPackage(ifacePkg, module);
    if (!canonicalPackage) {
      continue;
    }
    this.interfacePackagePlans.set(ifacePkg, {
      canonicalPackage,
      consumers: this.collectInterfacePackageConsumers(ifacePkg),
    });
    this.registerInterfacePackage(ifacePkg, canonicalPackage, false);
  }
  for (const [packageName, canonicalPackage] of this.stubbedInterfacePackages) {
    if (interfaceSources.has(packageName)) {
      continue;
    }
    this.interfacePackagePlans.set(packageName, {
      canonicalPackage,
      consumers: this.collectInterfacePackageConsumers(packageName),
    });
    this.registerInterfacePackage(packageName, canonicalPackage, true);
  }
}

export function resolveImplementedPackage(
  this: ManagerContext,
  packageName: string,
  module: Module,
): ResolvedPackage | undefined {
  const resolvedPackage = resolvePackage(packageName, module.manifest.folder);
  if (resolvedPackage) {
    return resolvedPackage;
  }
  if (module.manifest.manifest.name !== packageName) {
    return undefined;
  }
  return {
    ...resolvePackageAtRoot(
      packageName,
      module.manifest.folder,
      module.manifest.version,
    ),
    antelopeJs: module.manifest.manifest.antelopeJs,
  };
}

export function collectInterfacePackageConsumers(
  this: ManagerContext,
  packageName: string,
): InterfacePackageConsumer[] {
  const consumers: InterfacePackageConsumer[] = [];
  for (const { module } of this.loaded.values()) {
    const manifest = module.manifest.manifest;
    const range =
      manifest.dependencies?.[packageName] ??
      manifest.optionalDependencies?.[packageName];
    if (!range) {
      continue;
    }
    consumers.push({
      moduleId: module.id,
      range,
      resolvedPackage: resolvePackage(packageName, module.manifest.folder),
    });
  }
  return consumers;
}

export function registerInterfacePackage(
  this: ManagerContext,
  packageName: string,
  resolvedPackage: ResolvedPackage,
  isStubbed = false,
): void {
  this.resolver.interfacePackages.set(packageName, resolvedPackage.root);
  this.resolver.interfacePackageEntries.set(packageName, resolvedPackage.entry);
  this.resolver.interfacePackageResolveFrom.set(
    packageName,
    resolvedPackage.resolveFrom,
  );
  if (isStubbed) {
    this.resolver.stubbedInterfacePackages.add(packageName);
  } else {
    this.resolver.stubbedInterfacePackages.delete(packageName);
  }
  const implementations = resolvedPackage.antelopeJs?.implements;
  if (Array.isArray(implementations) && implementations.includes(packageName)) {
    this.resolver.lifecycleInterfacePackages.add(packageName);
    return;
  }
  this.resolver.lifecycleInterfacePackages.delete(packageName);
}

export function validateInterfacePackages(this: ManagerContext): void {
  const plans = [...this.interfacePackagePlans];
  const rangeConflicts = plans.flatMap(([name, plan]) =>
    this.findRangeConflicts(name, plan),
  );
  const preloadedCopies = plans.flatMap(([name, plan]) =>
    this.findPreloadedCopies(name, plan),
  );
  if (rangeConflicts.length === 0 && preloadedCopies.length === 0) {
    return;
  }
  throw new InterfaceResolutionError({ rangeConflicts, preloadedCopies });
}

export function findRangeConflicts(
  this: ManagerContext,
  packageName: string,
  plan: InterfacePackagePlan,
): InterfaceRangeConflict[] {
  return plan.consumers.flatMap((consumer) => {
    const range = validRange(consumer.range);
    if (!range || satisfies(plan.canonicalPackage.version, range)) {
      return [];
    }
    return [
      {
        moduleId: consumer.moduleId,
        packageName,
        range: consumer.range,
        canonical: plan.canonicalPackage,
        consumerCopy: consumer.resolvedPackage,
      },
    ];
  });
}

export function findPreloadedCopies(
  this: ManagerContext,
  packageName: string,
  plan: InterfacePackagePlan,
): PreloadedInterfaceCopy[] {
  const canonicalRoot = plan.canonicalPackage.realRoot;
  const loadedFiles = Object.keys(require.cache);
  return plan.consumers.flatMap(({ moduleId, resolvedPackage: copy }) => {
    if (!copy || copy.realRoot === canonicalRoot) {
      return [];
    }
    const isInCopy = createPathWithinMatcher(copy.root);
    const loadedFile = loadedFiles.find((filePath) => isInCopy(filePath));
    return loadedFile
      ? [
          {
            moduleId,
            packageName,
            copy,
            canonical: plan.canonicalPackage,
            loadedFile,
          },
        ]
      : [];
  });
}
