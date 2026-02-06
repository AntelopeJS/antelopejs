import { internal } from '../interfaces/core/beta';

export interface InterfaceConnectionRef {
  module: string;
  id?: string;
}

interface InterfaceConnectionEntry {
  path: string;
  id?: string;
}

export class InterfaceRegistry {
  setConnections(moduleId: string, connections: Map<string, InterfaceConnectionRef[]>): void {
    const connectionIDs: Record<string, InterfaceConnectionEntry[]> = {};
    for (const [interfaceName, modules] of connections) {
      connectionIDs[interfaceName] = modules.map(({ id, module }) => {
        const entry: InterfaceConnectionEntry = { path: `@ajs.raw/${module}/${interfaceName}` };
        if (id !== undefined) {
          entry.id = id;
        }
        return entry;
      });
    }
    internal.interfaceConnections[moduleId] = connectionIDs;
  }

  clearModule(moduleId: string): void {
    delete internal.interfaceConnections[moduleId];
  }
}
