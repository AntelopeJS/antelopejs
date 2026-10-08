import type { InterfaceConnection } from "@antelopejs/interface-core";
import { internal } from "@antelopejs/interface-core/internal";

import { connectionPath } from "./resolution/resolver";

export interface InterfaceConnectionRef {
  module?: string;
  id?: string;
}

type ModuleConnections = Record<string, InterfaceConnection[]>;

const ownersByModule = new Map<string, Map<symbol, ModuleConnections>>();

function createEntry(
  interfaceName: string,
  { module, id }: InterfaceConnectionRef,
  index: number,
  isSelected: boolean,
): InterfaceConnection {
  const entry: InterfaceConnection = {
    path: isSelected ? interfaceName : connectionPath(index, interfaceName),
    selected: isSelected,
  };
  if (module !== undefined) {
    entry.provider = module;
  }
  if (id !== undefined) {
    entry.id = id;
  }
  return entry;
}

export class InterfaceRegistry {
  private readonly owner = Symbol("interface-registry");
  private readonly moduleIds = new Set<string>();

  setConnections(
    moduleId: string,
    connections: Map<string, InterfaceConnectionRef[]>,
    selectedProviders: Map<string, string | undefined> = new Map(),
  ): void {
    const connectionIDs: ModuleConnections = {};
    for (const [interfaceName, listed] of connections) {
      const selectedIndex = selectedProviders.has(interfaceName)
        ? listed.findIndex(
            ({ module }) => module === selectedProviders.get(interfaceName),
          )
        : -1;
      connectionIDs[interfaceName] = listed.map((connection, index) =>
        createEntry(interfaceName, connection, index, index === selectedIndex),
      );
    }
    const owners = this.getCurrentOwners(moduleId);
    owners.set(this.owner, connectionIDs);
    this.moduleIds.add(moduleId);
    internal.interfaceConnections[moduleId] = connectionIDs;
  }

  clear(): void {
    for (const moduleId of this.moduleIds) {
      this.removeOwner(moduleId);
    }
    this.moduleIds.clear();
  }

  private getCurrentOwners(moduleId: string): Map<symbol, ModuleConnections> {
    const owners = ownersByModule.get(moduleId) ?? new Map();
    const current = internal.interfaceConnections[moduleId];
    if (current && [...owners.values()].includes(current)) {
      return owners;
    }
    owners.clear();
    ownersByModule.set(moduleId, owners);
    return owners;
  }

  private removeOwner(moduleId: string): void {
    const owners = ownersByModule.get(moduleId);
    if (!owners) {
      return;
    }
    const current = internal.interfaceConnections[moduleId];
    if (!current || ![...owners.values()].includes(current)) {
      ownersByModule.delete(moduleId);
      return;
    }
    owners.delete(this.owner);
    const remaining = [...owners.values()].at(-1);
    if (remaining) {
      internal.interfaceConnections[moduleId] = remaining;
      return;
    }
    delete internal.interfaceConnections[moduleId];
    ownersByModule.delete(moduleId);
  }
}
