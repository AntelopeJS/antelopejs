import { internal } from "@antelopejs/interface-core/internal";

export interface InterfaceConnectionRef {
  module: string;
  id?: string;
}

interface InterfaceConnectionEntry {
  path: string;
  id?: string;
  provider: string;
  selected: boolean;
}

export class InterfaceRegistry {
  setConnections(
    moduleId: string,
    connections: Map<string, InterfaceConnectionRef[]>,
    selectedProviders: Map<string, string>,
  ): void {
    const connectionIDs: Record<string, InterfaceConnectionEntry[]> = {};
    for (const [interfaceName, modules] of connections) {
      connectionIDs[interfaceName] = modules.map(({ module, id }) => {
        const entry: InterfaceConnectionEntry = {
          path: interfaceName,
          provider: module,
          selected: selectedProviders.get(interfaceName) === module,
        };
        if (id !== undefined) {
          entry.id = id;
        }
        return entry;
      });
    }
    internal.interfaceConnections[moduleId] = connectionIDs;
  }
}
