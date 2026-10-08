import { internal } from "@antelopejs/interface-core/internal";

export interface InterfaceConnectionRef {
  module?: string;
  id?: string;
}

interface InterfaceConnectionEntry {
  path: string;
  id?: string;
  provider: string;
  selected: boolean;
}

interface ProvidedConnectionRef extends InterfaceConnectionRef {
  module: string;
}

type ModuleConnections = Record<string, InterfaceConnectionEntry[]>;

const ownersByModule = new Map<string, Map<symbol, ModuleConnections>>();

function isProvided(
  connection: InterfaceConnectionRef,
): connection is ProvidedConnectionRef {
  return connection.module !== undefined;
}

function createEntry(
  interfaceName: string,
  { module, id }: ProvidedConnectionRef,
  isSelected: boolean,
): InterfaceConnectionEntry {
  const entry: InterfaceConnectionEntry = {
    path: interfaceName,
    provider: module,
    selected: isSelected,
  };
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
    for (const [interfaceName, configured] of connections) {
      const modules = configured.filter(isProvided);
      const selectedIndex = selectedProviders.has(interfaceName)
        ? modules.findIndex(
            ({ module }) => module === selectedProviders.get(interfaceName),
          )
        : -1;
      connectionIDs[interfaceName] = modules.map((connection, index) =>
        createEntry(interfaceName, connection, index === selectedIndex),
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
