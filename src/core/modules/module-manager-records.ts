import { Module } from "./module";
import {
  type ManagedModule,
  type ManagerContext,
  type ModuleConfig,
} from "./module-manager-context";
import { type ModuleManifest } from "./module-manifest";

export function addStaticModule(
  this: ManagerContext,
  entry: {
    manifest: ModuleManifest;
    config?: ModuleConfig;
  },
): void {
  const module = new Module(entry.manifest);
  const config: ModuleConfig = {
    config: entry.config?.config,
    importOverrides: entry.config?.importOverrides ?? new Map(),
    disabledExports: entry.config?.disabledExports ?? new Set(),
    exportPriority: entry.config?.exportPriority ?? new Map(),
  };
  this.registry.register(module);
  this.staticModules.push({ module, config });
}

export function addModules(
  this: ManagerContext,
  entries: Array<{ manifest: ModuleManifest; config?: ModuleConfig }>,
): ManagedModule[] {
  const created: ManagedModule[] = [];
  const replaced = new Map<string, ManagedModule | undefined>();
  for (const entry of entries) {
    replaced.set(entry.manifest.name, this.loaded.get(entry.manifest.name));
    const manifest = this.placeModule(entry.manifest.name, entry.manifest);
    const module = new Module(manifest);
    this.isolation.adopt(module.id, manifest);
    const config: ModuleConfig = {
      config: entry.config?.config,
      importOverrides: entry.config?.importOverrides ?? new Map(),
      disabledExports: entry.config?.disabledExports ?? new Set(),
      exportPriority: entry.config?.exportPriority ?? new Map(),
    };
    this.registry.register(module);
    const managed = { module, config };
    this.loaded.set(module.id, managed);
    created.push(managed);
  }

  try {
    this.rebuildAssociations();
  } catch (error) {
    this.restoreModules(replaced);
    throw error;
  }
  return created;
}

export function restoreModules(
  this: ManagerContext,
  replaced: ReadonlyMap<string, ManagedModule | undefined>,
): void {
  for (const [id, previous] of replaced) {
    this.isolation.forget(id);
    if (previous) {
      this.loaded.set(id, previous);
      this.registry.register(previous.module);
      this.isolation.adopt(id, previous.module.manifest);
    } else {
      this.loaded.delete(id);
      this.registry.unregister(id);
    }
  }
  this.rebuildAssociations();
}

export function discardModules(
  this: ManagerContext,
  ids: readonly string[],
): void {
  for (const id of ids) {
    this.isolation.forget(id);
    this.loaded.delete(id);
    this.registry.unregister(id);
  }
  this.rebuildAssociations();
}

export function listModules(this: ManagerContext): string[] {
  return this.registry.list();
}

export function getModule(
  this: ManagerContext,
  id: string,
): Module | undefined {
  return this.registry.get(id);
}

export function getModuleEntry(
  this: ManagerContext,
  id: string,
): ManagedModule | undefined {
  return (
    this.loaded.get(id) ??
    this.staticModules.find((entry) => entry.module.id === id)
  );
}

export function getLoadedModuleEntry(
  this: ManagerContext,
  id: string,
): ManagedModule | undefined {
  return this.loaded.get(id);
}

export function getLoadedModules(
  this: ManagerContext,
): IterableIterator<ManagedModule> {
  if (!(this.loaded instanceof Map)) {
    return new Map<string, ManagedModule>().values();
  }
  return this.loaded.values();
}

export function getAllManagedModules(this: ManagerContext): ManagedModule[] {
  return [...this.staticModules, ...this.loaded.values()];
}

export function setInstanceRoot(this: ManagerContext, root: string): void {
  this.isolation.setRoot(root);
}

export function placeModule(
  this: ManagerContext,
  moduleId: string,
  manifest: ModuleManifest,
): ModuleManifest {
  return this.isolation.place(moduleId, manifest);
}

export function discardPlacedModule(
  this: ManagerContext,
  manifest: ModuleManifest,
): void {
  this.isolation.discard(manifest);
}

export function replaceLoadedModule(
  this: ManagerContext,
  id: string,
  module: Module,
): ManagedModule | undefined {
  const entry = this.loaded.get(id);
  if (!entry) {
    return;
  }
  this.isolation.adopt(id, module.manifest);
  entry.module = module;
  this.registry.register(module);
  return entry;
}
