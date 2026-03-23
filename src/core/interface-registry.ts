import { internal } from "@antelopejs/interface-core/internal";

export interface InterfaceConnectionRef {
  module: string;
  id?: string;
}

interface InterfaceConnectionEntry {
  path: string;
  id?: string;
}

export class InterfaceRegistry {
  setConnections(
    moduleId: string,
    connections: Map<string, InterfaceConnectionRef[]>,
  ): void {
    const connectionIDs: Record<string, InterfaceConnectionEntry[]> = {};
    for (const [interfaceName, modules] of connections) {
      connectionIDs[interfaceName] = modules.map(({ id }) => {
        const entry: InterfaceConnectionEntry = {
          path: interfaceName,
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
